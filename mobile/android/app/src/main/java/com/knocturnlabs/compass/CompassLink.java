package com.knocturnlabs.compass;

import java.net.URI;
import java.util.Locale;

/**
 * Phase 4: where the app may go (the Android twin of ios/App/App/CompassLink.swift). java.net only, so mobile/test-java.sh checks it
 * with javac alone. Rules (Global Constraints, native contract): the web view stays on the Compass host; any other web page opens in
 * the system browser, mailto: and tel: in their apps, and every other scheme goes nowhere. Sign-in opens only Knocturn ID and comes
 * back only to compass://.
 */
final class CompassLink {
    static final String HOME = "compass.knocturnlabs.com";
    static final String SIGN_IN_HOST = "id.knocturnlabs.com";
    static final String CALLBACK_SCHEME = "compass";

    enum Route { IN_APP, EXTERNAL, DROP }

    private CompassLink() {}

    static URI parse(String raw) {
        if (raw == null) return null;
        try { return new URI(raw); } catch (Exception e) { return null; }
    }

    private static String lower(String s) { return s == null ? null : s.toLowerCase(Locale.ROOT); }

    private static boolean same(String a, String b) { return a != null && a.equalsIgnoreCase(b); }

    /** Same scheme, host and port as the server the app shows (https://compass.knocturnlabs.com, or COMPASS_URL for local tests). */
    static boolean onServer(URI url, URI server) {
        return same(url.getScheme(), server.getScheme()) && same(url.getHost(), server.getHost()) && url.getPort() == server.getPort()
            && url.getRawUserInfo() == null;
    }

    /** A top-level navigation (link, redirect, window.open) to `url` while the app shows `server`. */
    static Route route(URI url, URI server) {
        String scheme = lower(url.getScheme());
        if ("http".equals(scheme) || "https".equals(scheme)) return onServer(url, server) ? Route.IN_APP : Route.EXTERNAL;
        if ("mailto".equals(scheme) || "tel".equals(scheme)) return Route.EXTERNAL;
        return Route.DROP;
    }

    /** What openExternal may open: a web page, mailto: or tel:. Anything else is null. */
    static String external(String raw) {
        URI url = parse(raw);
        String scheme = url == null ? null : lower(url.getScheme());
        return "http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme) ? raw : null;
    }

    /** The page asked for a sign-in tab: only Knocturn ID's https page, and only back to compass://. Anything else is null. */
    static String signIn(String raw, String callbackScheme) {
        URI url = CALLBACK_SCHEME.equals(callbackScheme) ? parse(raw) : null;
        if (url == null || !"https".equals(url.getScheme()) || !SIGN_IN_HOST.equals(url.getHost()) || url.getPort() != -1 || url.getRawUserInfo() != null) return null;
        return raw;
    }

    /** A notification's (or an App Link's) url: a path such as /meetings/1, or a full Compass URL, kept with its ?search#hash.
     *  Only the Compass host (or the server the app shows); null for anything else. */
    static String open(Object raw, URI server) {
        if (!(raw instanceof String) || ((String) raw).isEmpty()) return null;
        URI url = parse((String) raw);
        if (url == null) return null;
        String path = server.getRawPath();
        URI abs = (path == null || path.isEmpty() ? server.resolve("/") : server).resolve(url);
        boolean compass = same(abs.getScheme(), "https") && same(abs.getHost(), HOME) && abs.getPort() == -1 && abs.getRawUserInfo() == null;
        return compass || onServer(abs, server) ? abs.toString() : null;
    }

    /** What a share (ACTION_SEND text/plain) puts in quick add: browsers send the page title as the subject and the URL as the text,
     *  so the title goes first (quick add's title) and the URL after it (its notes). Null when there is nothing. */
    static String shared(String subject, String text) {
        String t = text == null ? "" : text.trim();
        String s = subject == null ? "" : subject.trim();
        if (t.isEmpty()) return s.isEmpty() ? null : s;
        return s.isEmpty() || t.contains(s) ? t : s + "\n" + t;
    }

    /** A download's file name that can't name a folder: the last path part, no control characters, 150 characters at most. */
    static String fileName(String raw) {
        String name = raw == null ? "" : raw.replaceAll("[\\u0000-\\u001f\\u007f]", "");
        name = name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).trim();
        if (name.length() > 150) name = name.substring(0, 150).trim();
        return name.isEmpty() || name.equals(".") || name.equals("..") ? "download" : name;
    }
}
