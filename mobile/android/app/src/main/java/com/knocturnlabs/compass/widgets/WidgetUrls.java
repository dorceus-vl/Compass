package com.knocturnlabs.compass.widgets;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * v2.3 (Android, A4/A6): where a widget tap and a tick may go, and the tick's request. java.net and javax.net.ssl only, so mobile/test-java.sh checks it with javac alone (the twin
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

    /** The tick's request, byte for byte: the bearer token is its only credential. No Cookie header can be added on the way. */
    static byte[] request(URI u, String token) {
        String host = u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort());
        return ("POST " + u.getRawPath() + " HTTP/1.1\r\nHost: " + host + "\r\nAuthorization: Bearer " + token
            + "\r\nContent-Length: 0\r\nUser-Agent: CompassWidget\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
    }

    /**
     * POSTs a tick to `url` (built by doneUrl) and returns the status, or -1 with no usable answer. A plain socket, not HttpURLConnection:
     * Capacitor installs a process-wide CookieHandler that would attach the web view's cookies (the session included) to any
     * HttpURLConnection, and this request must carry the token alone. https is verified against the host (`verify`, the platform's
     * default verifier on Android); a redirect is just a status (never followed); `timeoutMs` bounds the connect and each read.
     */
    public static int post(String url, String token, SSLSocketFactory tls, HostnameVerifier verify, int timeoutMs) {
        if (!validTokenShape(token)) return -1;
        Socket s = null;
        try {
            URI u = new URI(url);
            boolean https = "https".equals(u.getScheme());
            if (!https && !"http".equals(u.getScheme())) return -1;
            String host = u.getHost();
            int port = u.getPort() == -1 ? (https ? 443 : 80) : u.getPort();
            s = new Socket();
            s.connect(new InetSocketAddress(host, port), timeoutMs);
            s.setSoTimeout(timeoutMs);
            if (https) {
                SSLSocket ssl = (SSLSocket) tls.createSocket(s, host, port, true); // the host name goes out as SNI
                s = ssl;
                ssl.startHandshake();
                if (verify == null || !verify.verify(host, ssl.getSession())) return -1;
            }
            OutputStream out = s.getOutputStream();
            out.write(request(u, token));
            out.flush();
            return status(s.getInputStream());
        } catch (Exception e) {
            return -1;
        } finally {
            if (s != null) try { s.close(); } catch (Exception ignored) { /* closing */ }
        }
    }

    /** The status of "HTTP/1.x NNN ...", from the first line (at most 200 bytes); -1 for anything else. */
    static int status(InputStream in) throws java.io.IOException {
        StringBuilder line = new StringBuilder();
        for (int c; line.length() < 200 && (c = in.read()) != -1 && c != '\n'; ) line.append((char) c);
        String[] p = line.toString().trim().split(" ");
        if (p.length < 2 || !p[0].matches("HTTP/1\\.[01]") || !p[1].matches("[1-5][0-9][0-9]")) return -1;
        return Integer.parseInt(p[1]);
    }

    /** Same shape as WidgetStore.validToken: nothing that could break the request line goes in it. */
    private static boolean validTokenShape(String t) { return t != null && t.matches("[A-Za-z0-9_-]{16,200}"); }
}
