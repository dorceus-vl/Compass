package com.knocturnlabs.compass.widgets;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The widgets' files in the app's private files dir (A3) and the token's sealing (A5): java.io, javax.crypto and org.json only, so
 * mobile/test-java.sh checks it with javac. The twin of ios/App/App/WidgetStore.swift. On Android the app, its widget providers and the
 * tick receiver share one process, so one lock (this class) keeps every read-modify-write whole; files are replaced by rename.
 */
public final class WidgetStore {
    public static final String SNAPSHOT = "widget-snapshot.json";
    public static final String TICKS = "pending-ticks.json";
    public static final int MAX_BYTES = 64 * 1024;
    public static final int MAX_TICKS = 200;

    public static final class Failure extends Exception {
        public final String code;
        Failure(String code) { super(code); this.code = code; }
    }

    private WidgetStore() {}

    /** Writes the snapshot; '' removes it (signed out). Refuses text over 64 KB ("too_big") or that isn't a JSON object ("invalid_request"). */
    public static synchronized void write(File dir, String json) throws Failure, IOException {
        File file = new File(dir, SNAPSHOT);
        if (json == null || json.isEmpty()) { file.delete(); return; }
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        if (data.length > MAX_BYTES) throw new Failure("too_big");
        try { new JSONObject(json); } catch (JSONException e) { throw new Failure("invalid_request"); }
        replace(file, data);
    }

    /** The snapshot, or null (none yet, signed out, unreadable). */
    public static synchronized WidgetSnapshot read(File dir) {
        byte[] data = readAll(new File(dir, SNAPSHOT));
        return data == null ? null : WidgetSnapshot.parse(new String(data, StandardCharsets.UTF_8));
    }

    /** A tick's local half: the widget shows it at once, and it waits in pending-ticks.json until the server has it (or the app takes it). */
    public static synchronized void tick(File dir, String id, String at) throws IOException {
        WidgetSnapshot s = read(dir);
        String after = s == null ? null : s.markingDone(id);
        if (after != null && after.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES) replace(new File(dir, SNAPSHOT), after.getBytes(StandardCharsets.UTF_8));
        appendTick(dir, id, at);
    }

    /** v2.5 Start or Stop on a widget: the change shows at once, and the action waits in pending-ticks.json until the server has it (or the app takes it). */
    public static synchronized void timer(File dir, String id, String action, String at) throws IOException {
        if (!validAction(action) || action == null) return;
        WidgetSnapshot s = read(dir);
        String after = s == null ? null : s.timing(id, action, at);
        if (after != null && after.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES) replace(new File(dir, SNAPSHOT), after.getBytes(StandardCharsets.UTF_8));
        appendTick(dir, id, at, action);
    }

    /** A pending entry's action: null is a done tick (files from before timers read the same), "start" or "stop" a timer action. */
    static boolean validAction(String a) { return a == null || "start".equals(a) || "stop".equals(a); }

    /** What a widget couldn't send, oldest first, as {id, at, action} (action null: a done tick); the file is cleared as it is read. Malformed entries, and an
     *  unknown action (never read as a done tick), are dropped. */
    public static synchronized List<String[]> takeTicks(File dir) {
        File file = new File(dir, TICKS);
        JSONArray list = ticks(file);
        file.delete();
        List<String[]> out = new ArrayList<>();
        for (int i = 0; i < list.length() && out.size() < MAX_TICKS; i++) {
            JSONObject t = list.optJSONObject(i);
            Object id = t == null ? null : t.opt("id"), at = t == null ? null : t.opt("at"), action = t == null || t.isNull("action") ? null : t.opt("action");
            if (action != null && !(action instanceof String && validAction((String) action))) continue;
            if (id instanceof String && at instanceof String && validId((String) id) && ((String) at).length() <= 40) out.add(new String[] { (String) id, (String) at, (String) action });
        }
        return out;
    }

    /** Keeps a done tick for later. */
    public static synchronized void appendTick(File dir, String id, String at) throws IOException { appendTick(dir, id, at, null); }

    /** Keeps a done tick (action null) or a timer action for later. A tap that repeats the last queued action for the same task is kept once (start, stop, start
     *  stays three, in order); past MAX_TICKS new ones are dropped. */
    public static synchronized void appendTick(File dir, String id, String at, String action) throws IOException {
        if (!validId(id) || at == null || at.length() > 40 || !validAction(action)) return;
        File file = new File(dir, TICKS);
        JSONArray list = ticks(file);
        if (list.length() >= MAX_TICKS) return;
        for (int i = list.length() - 1; i >= 0; i--) {
            JSONObject t = list.optJSONObject(i);
            if (t == null || !id.equals(t.opt("id"))) continue;
            if (java.util.Objects.equals(action, t.isNull("action") ? null : t.opt("action"))) return;
            break; // only the last entry for this task counts
        }
        try {
            JSONObject e = new JSONObject().put("id", id).put("at", at);
            if (action != null) e.put("action", action);
            list.put(e);
        } catch (JSONException e) { return; }
        replace(file, list.toString().getBytes(StandardCharsets.UTF_8));
    }

    /** Drops the task's done ticks the server now has, so the app doesn't send them again. */
    public static synchronized void removeTick(File dir, String id) throws IOException { removeTick(dir, id, null, null); }

    /** Drops what the server now has (a 200). A done tick (action null) drops the task's done ticks; a timer action drops its own entry (same `at`) and every
     *  earlier timer action of that task, which the server's answer settles too (a 200 start means none was running; after a 200 stop none is). */
    public static synchronized void removeTick(File dir, String id, String action, String at) throws IOException {
        File file = new File(dir, TICKS);
        JSONArray list = ticks(file), kept = new JSONArray();
        int mine = -1;
        if (action != null) {
            for (int i = 0; i < list.length(); i++) { JSONObject t = list.optJSONObject(i); if (timerOf(t, id) && action.equals(t.opt("action")) && String.valueOf(at).equals(t.opt("at"))) mine = i; }
            if (mine < 0) return;
        }
        for (int i = 0; i < list.length(); i++) {
            JSONObject t = list.optJSONObject(i);
            boolean drop = action == null ? t != null && String.valueOf(id).equals(t.opt("id")) && t.isNull("action") : i <= mine && timerOf(t, id);
            if (!drop) kept.put(list.opt(i));
        }
        if (kept.length() == list.length()) return;
        if (kept.length() == 0) file.delete();
        else replace(file, kept.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static boolean timerOf(JSONObject t, String id) {
        return t != null && String.valueOf(id).equals(t.opt("id")) && ("start".equals(t.opt("action")) || "stop".equals(t.opt("action")));
    }

    static boolean validId(String id) { return id != null && !id.isEmpty() && id.length() <= 64; }

    private static JSONArray ticks(File file) {
        byte[] data = readAll(file);
        try { return data == null ? new JSONArray() : new JSONArray(new String(data, StandardCharsets.UTF_8)); } catch (JSONException e) { return new JSONArray(); }
    }

    /** Atomic: the new text goes to a temporary file in the same folder, then replaces the old one by rename. */
    static void replace(File file, byte[] data) throws IOException {
        File tmp = new File(file.getParentFile(), file.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
            out.getFD().sync();
        }
        if (!tmp.renameTo(file)) { tmp.delete(); throw new IOException("rename failed"); }
    }

    private static byte[] readAll(File file) {
        if (!file.isFile() || file.length() > MAX_BYTES * 4L) return null;
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[(int) file.length()];
            int n = 0;
            for (int r; n < buf.length && (r = in.read(buf, n, buf.length - n)) > 0; ) n += r;
            return n == buf.length ? buf : Arrays.copyOf(buf, n);
        } catch (IOException e) {
            return null;
        }
    }

    // ---- the tick token (A5): AES-GCM under a key the caller holds (the Android Keystore's, in WidgetToken) ----

    /** A token is the text the server gave: letters, digits, '-' and '_', 16 to 200 characters. Nothing else is stored. */
    public static boolean validToken(String t) {
        if (t == null || t.length() < 16 || t.length() > 200) return false;
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '-' || c == '_')) return false;
        }
        return true;
    }

    /** iv (12 bytes) followed by the ciphertext and tag. The cipher picks the iv (the Keystore requires it). */
    public static byte[] seal(SecretKey key, String token) throws GeneralSecurityException {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = c.getIV(), ct = c.doFinal(token.getBytes(StandardCharsets.UTF_8));
        if (iv == null || iv.length != 12) throw new GeneralSecurityException("unexpected iv");
        byte[] out = Arrays.copyOf(iv, 12 + ct.length);
        System.arraycopy(ct, 0, out, 12, ct.length);
        return out;
    }

    /** The token, or null when the blob doesn't open under `key` (another key, tampered, too short) or isn't a valid token. */
    public static String open(SecretKey key, byte[] blob) {
        if (key == null || blob == null || blob.length <= 12 + 16) return null;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, blob, 0, 12));
            String t = new String(c.doFinal(blob, 12, blob.length - 12), StandardCharsets.UTF_8);
            return validToken(t) ? t : null;
        } catch (GeneralSecurityException | RuntimeException e) {
            return null;
        }
    }
}
