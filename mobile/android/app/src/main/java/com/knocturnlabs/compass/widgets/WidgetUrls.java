package com.knocturnlabs.compass.widgets;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * v2.3 (Android, A4/A6): where a widget tap and a tick may go. java.net only, so mobile/test-java.sh checks it with javac alone (the twin
 * of CompassURL and WidgetServer in ios/App/CompassWidgets/Snapshot.swift). Taps are https links on the Compass host, which MainActivity
 * hands to CompassNativePlugin and CompassLink.open (Compass only). A tick goes to Compass's own server and nothing else:
 * https://compass.knocturnlabs.com, or in a debuggable build only, plain http on localhost / 127.0.0.1 (COMPASS_URL with adb reverse).
 */
public final class WidgetUrls {
    public static final String BASE = "https://compass.knocturnlabs.com";
    public static final String TODAY = BASE + "/";
    public static final String QUICK_ADD = BASE + "/?quickadd=1";
    public static final String ATHENA = BASE + "/athena";

    private WidgetUrls() {}

    /** Percent-encodes everything but letters, digits, '-' and '_' (UTF-8). */
    static String encode(String s) {
        StringBuilder out = new StringBuilder();
        for (byte b : s.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xFF;
            if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '-' || c == '_') out.append((char) c);
            else out.append('%').append(String.format(Locale.ROOT, "%02X", c));
        }
        return out.toString();
    }

    public static String task(String id) { return id == null || id.isEmpty() ? TODAY : BASE + "/?task=" + encode(id); }
    public static String dashboard(String id) { return id == null || id.isEmpty() ? TODAY : BASE + "/projects/" + encode(id) + "/dashboard"; }

    /** A server a tick may go to: no user, path, query or fragment; https on the Compass host with no port, or (allowLocal) http on this machine. */
    static boolean allowed(String raw, boolean allowLocal) {
        URI u;
        try { u = new URI(raw); } catch (Exception e) { return false; }
        String path = u.getRawPath(), scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (u.getRawUserInfo() != null || u.getRawQuery() != null || u.getRawFragment() != null || u.getHost() == null) return false;
        if (path != null && !path.isEmpty() && !path.equals("/")) return false;
        String host = u.getHost().toLowerCase(Locale.ROOT);
        if (scheme.equals("https")) return host.equals("compass.knocturnlabs.com") && u.getPort() == -1;
        return allowLocal && scheme.equals("http") && (host.equals("localhost") || host.equals("127.0.0.1"));
    }

    /** The server a build talks to: production, unless a debuggable build's config (capacitor.config.json server.url) names a local one. */
    public static String server(String configured, boolean debuggable) {
        return debuggable && configured != null && allowed(configured, true) ? configured.replaceAll("/$", "") : BASE;
    }

    /** POST target for a tick: <server>/api/widget/tasks/<id>/done, or null for a server that isn't Compass or an id that isn't plain. */
    public static String doneUrl(String id, String server, boolean allowLocal) {
        if (id == null || id.isEmpty() || id.length() > 64 || server == null || !allowed(server, allowLocal)) return null;
        return server.replaceAll("/$", "") + "/api/widget/tasks/" + encode(id) + "/done";
    }

    /** Only 200 settles a tick. A 404 stays queued (a task made offline may not be on the server yet), and so do 401, 429, 5xx and no answer. */
    public static boolean settles(int status) { return status == 200; }
}
