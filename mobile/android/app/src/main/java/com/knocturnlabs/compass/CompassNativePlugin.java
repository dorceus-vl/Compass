package com.knocturnlabs.compass;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.widget.Toast;
import androidx.activity.result.ActivityResult;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import org.json.JSONObject;

/**
 * Phase 4: what the page can't do itself in the app (the Android twin of ios/App/App/CompassNative.swift). web/src/native.ts is the
 * caller; the contract is in its header:
 *   signIn({ url, callbackScheme }) → { url }      Knocturn ID in a Custom Tab (N1); back at compass://auth; a closed tab rejects 'cancelled'
 *   registerPush() → { kind: 'fcm', token } | { unsupported: true } (no google-services.json) | { denied: true }
 *   takeSharedText() → { text: null }               a share (ACTION_SEND text/plain) goes straight out as the event below, so none waits
 *   openExternal({ url })                           http(s), mailto:, tel: in the system
 *   events sharedText { text }, notificationTap { url }   (kept until the page listens, so a cold start loses neither)
 * It also decides every top-level navigation of the web view (CompassLink.route): Compass stays in, other pages go to the browser.
 * saveDownload is CompassDownloads' half (not part of the page's contract): the file's base64 in parts, then the system's Save dialog.
 */
@CapacitorPlugin(name = "CompassNative", permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"))
public class CompassNativePlugin extends Plugin {
    private PluginCall signIn; // the page waiting for Knocturn ID (main thread only)
    private boolean signInAway; // the Custom Tab has been in front since signIn started

    URI server() { return URI.create(getBridge().getAppUrl()); }

    @Override
    public void load() {
        CompassDownloads.install(this);
    }

    // ---- Intents: the sign-in answer, App Links, shares and notification taps. Capacitor sends the launch intent here too. ----

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && data != null) {
            if (CompassLink.CALLBACK_SCHEME.equals(data.getScheme())) finishSignIn(data);
            else deliverOpen(data.toString()); // an App Link to compass.knocturnlabs.com
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = CompassLink.shared(string(intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)), string(intent.getCharSequenceExtra(Intent.EXTRA_TEXT)));
            // Handed over now and kept by Capacitor until the page listens: nothing stays pending, so it is never delivered twice.
            if (text != null) notifyListeners("sharedText", new JSObject().put("text", text), true);
        } else {
            // A notification tap: Firebase (app in the background) or CompassMessaging (app in front) put the message's url in the intent.
            String url = intent.getStringExtra("url");
            if (url != null) deliverOpen(url);
        }
    }

    private static String string(CharSequence s) { return s == null ? null : s.toString(); }

    /** A notification tap or an App Link: the page opens it in place (only Compass URLs). */
    private void deliverOpen(String raw) {
        String url = CompassLink.open(raw, server());
        if (url != null) notifyListeners("notificationTap", new JSObject().put("url", url), true);
    }

    // ---- Sign-in (Hollow's Custom Tab pattern) ----

    @PluginMethod
    public void signIn(PluginCall call) {
        String url = CompassLink.signIn(call.getString("url"), call.getString("callbackScheme"));
        if (url == null) {
            call.reject("Sign-in couldn’t start.", "invalid_request");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (signIn != null) signIn.reject("Sign-in was cancelled.", "cancelled");
            signIn = call;
            signInAway = false;
            CustomTabColorSchemeParams ground = new CustomTabColorSchemeParams.Builder().setToolbarColor(0xFF050507).build();
            try {
                new CustomTabsIntent.Builder().setDefaultColorSchemeParams(ground).build().launchUrl(getActivity(), Uri.parse(url));
            } catch (ActivityNotFoundException e) {
                signIn = null;
                call.reject("Sign-in couldn’t start: no browser.", "failed");
            }
        });
    }

    /** compass://auth?code=…&state=… (or ?error=…): the page checks the state and trades the code. */
    private void finishSignIn(Uri callback) {
        if (signIn == null || !"auth".equals(callback.getHost())) return;
        signIn.resolve(new JSObject().put("url", callback.toString()));
        signIn = null;
    }

    @Override
    protected void handleOnPause() {
        if (signIn != null) signInAway = true;
    }

    /** Back in front without an answer (the tab was closed, or the person came back another way): the sign-in was cancelled. A
     *  compass://auth answer arrives in onNewIntent, before this. */
    @Override
    protected void handleOnResume() {
        if (signIn == null || !signInAway) return;
        signIn.reject("Sign-in was cancelled.", "cancelled");
        signIn = null;
    }

    // ---- Push (FCM, only in a build with google-services.json) ----

    @PluginMethod
    public void registerPush(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.resolve(new JSObject().put("unsupported", true));
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "pushPermission");
            return;
        }
        pushToken(call);
    }

    @PermissionCallback
    private void pushPermission(PluginCall call) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) pushToken(call);
        else call.resolve(new JSObject().put("denied", true));
    }

    private void pushToken(PluginCall call) {
        if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            call.resolve(new JSObject().put("denied", true));
            return;
        }
        CompassMessaging.channel(getContext());
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) call.resolve(new JSObject().put("kind", "fcm").put("token", task.getResult()));
            else call.reject("Google’s push service didn’t answer. Try again in a moment.", "failed");
        });
    }

    // ---- Shared text ----

    @PluginMethod
    public void takeSharedText(PluginCall call) {
        call.resolve(new JSObject().put("text", JSONObject.NULL));
    }

    // ---- Links ----

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = CompassLink.external(call.getString("url"));
        if (url == null) {
            call.reject("That link can’t be opened.", "invalid_request");
            return;
        }
        view(url);
        call.resolve();
    }

    private void view(String url) {
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignored) {
            // no app for it: nothing happens, as in a browser
        }
    }

    /** Every top-level navigation of the web view (links, redirects, window.open) comes here first (Capacitor's Bridge.launchIntent).
     *  false: the web view goes there; true: it doesn't (we opened it elsewhere, or nowhere). */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if ("about".equals(url.getScheme())) return null;
        URI target = CompassLink.parse(url.toString());
        if (target == null) return true;
        URI server = server();
        CompassLink.Route route = CompassLink.route(target, server);
        if (route == CompassLink.Route.IN_APP) return false;
        if (getBridge().getScheme().equals(url.getScheme()) && getBridge().getHost().equals(url.getAuthority())) {
            // The bundled offline page; its "Try again" (or anything else local) goes back to the site.
            if (url.toString().equals(getBridge().getErrorUrl())) return false;
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(getBridge().getAppUrl()));
            return true;
        }
        if (route == CompassLink.Route.EXTERNAL) view(url.toString());
        return true;
    }

    // ---- Downloads (CompassDownloads' script sends the file here in parts) ----

    @PluginMethod
    public void saveDownload(PluginCall call) {
        String id = call.getString("id", "");
        File part = id.matches("[a-z0-9]{1,40}") ? new File(CompassDownloads.folder(getContext()), id) : null;
        if (call.getBoolean("failed", false) || part == null) {
            if (part != null) part.delete();
            toast("That file couldn’t be downloaded.");
            call.resolve();
            return;
        }
        try (OutputStream out = new FileOutputStream(part, true)) {
            out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
        } catch (Exception e) {
            part.delete();
            toast("That file couldn’t be downloaded.");
            call.reject("That file couldn’t be downloaded.", "failed");
            return;
        }
        if (!call.getBoolean("last", false)) {
            call.resolve();
            return;
        }
        String type = call.getString("type", "").split(";")[0].trim();
        Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(type.isEmpty() ? "application/octet-stream" : type)
            .putExtra(Intent.EXTRA_TITLE, CompassLink.fileName(call.getString("name")));
        startActivityForResult(call, save, "saved");
    }

    /** The Save dialog closed: copy the file where the person chose (or nowhere), then drop the temporary copy. */
    @ActivityCallback
    private void saved(PluginCall call, ActivityResult result) {
        File part = new File(CompassDownloads.folder(getContext()), call.getString("id", ""));
        Uri to = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        getBridge().execute(() -> {
            if (to != null) {
                try (InputStream in = new FileInputStream(part); OutputStream out = getContext().getContentResolver().openOutputStream(to)) {
                    if (out == null) throw new java.io.IOException("no output");
                    byte[] buf = new byte[64 * 1024];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    toast("Saved.");
                } catch (Exception e) {
                    toast("That file couldn’t be saved.");
                }
            }
            part.delete();
            call.resolve();
        });
    }

    private void toast(String text) {
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), text, Toast.LENGTH_SHORT).show());
    }
}
