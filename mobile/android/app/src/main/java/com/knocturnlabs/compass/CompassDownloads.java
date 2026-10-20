package com.knocturnlabs.compass;

import android.content.Context;
import android.net.Uri;
import android.webkit.URLUtil;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.File;
import java.net.URI;
import java.util.Collections;
import org.json.JSONObject;

/**
 * Downloads in the app (Android's web view has none; ruling P4-4). Compass makes reports and exports on the device as a Blob behind an
 * `<a download>`, and serves documents as attachments from /api. Both reach the native side as the file's bytes, base64 in 512 KB parts
 * through CompassNative.saveDownload, then a last call with no data (the call waiting on the Save dialog is kept in the activity's saved
 * state, which can't hold a part), and the system's Save dialog (Downloads, Drive, …) asks where the file goes.
 *  - A Blob: a script that runs before the page's own (Compass's origin only) remembers each Blob the page turns into a URL; a click on
 *    an `<a download>` for one of them reads it there. (The page's CSP, connect-src 'self', forbids fetching a blob: URL, so it must
 *    be the Blob itself.)
 *  - A Compass URL the web view would download (an attachment, an `<a download href="/api/…">`): the same script fetches it with the
 *    page's cookie.
 * Any other host never downloads.
 */
final class CompassDownloads {
    private CompassDownloads() {}

    private static final String SCRIPT = String.join("\n",
        "(() => {",
        "  if (window.__compassSave) return;",
        "  const blobs = new Map();",
        "  const make = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);",
        "  URL.createObjectURL = (o) => { const u = make(o); if (o instanceof Blob) blobs.set(u, o); return u; };",
        "  URL.revokeObjectURL = (u) => { blobs.delete(u); revoke(u); };",
        "  const call = (args) => window.Capacitor.nativePromise('CompassNative', 'saveDownload', args);",
        "  const part = (blob) => new Promise((ok, no) => { const r = new FileReader();",
        "    r.onload = () => { const s = String(r.result); ok(s.slice(s.indexOf(',') + 1)); }; r.onerror = () => no(r.error); r.readAsDataURL(blob); });",
        "  const save = async (blob, name) => {",
        "    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10), step = 512 * 1024;",
        "    try {",
        "      for (let at = 0; at < blob.size; at += step) await call({ id, data: await part(blob.slice(at, at + step)) });",
        "      await call({ id, name, type: blob.type, last: true });",
        "    } catch { call({ id, failed: true }).catch(() => {}); }",
        "  };",
        "  window.__compassSave = async (url, name) => {",
        "    let blob;",
        "    try { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(); blob = await r.blob(); }",
        "    catch { return call({ failed: true }).catch(() => {}); }",
        "    await save(blob, name);",
        "  };",
        "  addEventListener('click', (e) => {",
        "    const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;",
        "    const blob = a && blobs.get(a.href);",
        "    if (!blob) return;",
        "    e.preventDefault();",
        "    save(blob, a.getAttribute('download') || 'download');",
        "  }, true);",
        "})();");

    /** Where the parts wait for the Save dialog; emptied when the app starts (a part left by a reload mid-way is never finished). */
    static File folder(Context context) {
        File dir = new File(context.getCacheDir(), "downloads");
        dir.mkdirs();
        return dir;
    }

    static void install(CompassNativePlugin plugin) {
        File[] old = folder(plugin.getContext()).listFiles();
        if (old != null) for (File f : old) f.delete();
        WebView web = plugin.getBridge().getWebView();
        String origin = Uri.parse(plugin.getBridge().getAppUrl()).buildUpon().path(null).fragment(null).clearQuery().build().toString();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, SCRIPT, Collections.singleton(origin));
        }
        web.setDownloadListener((url, userAgent, disposition, mimeType, length) -> {
            URI target = CompassLink.parse(url);
            if (target == null || CompassLink.route(target, plugin.server()) != CompassLink.Route.IN_APP) return; // blob: is the script's; other hosts never
            String name = URLUtil.guessFileName(url, disposition, mimeType);
            web.evaluateJavascript("window.__compassSave && window.__compassSave(" + JSONObject.quote(url) + ", " + JSONObject.quote(name) + ")", null);
        });
    }
}
