package com.knocturnlabs.compass.widgets;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import com.getcapacitor.CapConfig;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Set;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocketFactory;

/**
 * A widget's tick circle (A4, the twin of MarkDoneIntent on iOS), and since v2.5 its Start and Stop buttons (the twin of TimerIntent). Not exported: only the app's
 * own PendingIntents reach it. The change shows at once (the snapshot is rewritten and every widget redrawn) and is queued in pending-ticks.json (a timer action with
 * its `action`). Then, with the token from WidgetToken, it POSTs https://compass.knocturnlabs.com/api/widget/tasks/<id>/done (or /timer with {action, at}) over a
 * plain TLS socket (WidgetUrls.post: the token is the only credential, never the web view's cookies; 8 seconds in all; redirects never followed); a 200 drops the
 * queued entry. No token, or any other answer, leaves it queued for the app (takeWidgetTicks, offline queue).
 */
public final class TickReceiver extends BroadcastReceiver {
    static final String ACTION = "com.knocturnlabs.compass.widgets.TICK";
    // Taps for different tasks run side by side (each under its own deadline); one task is never ticked (or timed) twice at once.
    private static final ExecutorService WORK = Executors.newCachedThreadPool();
    private static final Set<String> IN_FLIGHT = new HashSet<>();

    /** A tap on one task: an explicit, immutable broadcast to this receiver; the task id is the data (so each row has its own) and the scheme says what to do:
     *  compass-tick (done), compass-start, compass-stop (`timer` null, "start" or "stop"). */
    static PendingIntent intent(Context c, String id, String timer) {
        Intent i = new Intent(c, TickReceiver.class).setAction(ACTION).setData(Uri.fromParts(timer == null ? "compass-tick" : "compass-" + timer, id, null));
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        Uri data = intent.getData();
        String scheme = data == null ? null : data.getScheme();
        boolean ours = ACTION.equals(intent.getAction()) && ("compass-tick".equals(scheme) || "compass-start".equals(scheme) || "compass-stop".equals(scheme));
        String id = ours ? data.getSchemeSpecificPart() : null, timer = ours && !"compass-tick".equals(scheme) ? scheme.substring("compass-".length()) : null;
        if (!WidgetStore.validId(id)) return;
        synchronized (IN_FLIGHT) { if (!IN_FLIGHT.add(id)) return; } // a second tap on the same task while the first is still going: dropped
        Context app = context.getApplicationContext();
        PendingResult done = goAsync();
        WORK.execute(() -> {
            try {
                String at = now();
                try {
                    if (timer == null) WidgetStore.tick(app.getFilesDir(), id, at);
                    else WidgetStore.timer(app.getFilesDir(), id, timer, at);
                } catch (Exception ignored) { /* the post below still runs */ }
                WidgetProviders.refreshAll(app);
                boolean debuggable = (app.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
                String server = WidgetUrls.server(CapConfig.loadDefault(app).getServerUrl(), debuggable), token = WidgetToken.read(app);
                if (timer == null) {
                    String url = WidgetUrls.doneUrl(id, server, debuggable);
                    if (url != null && token != null && WidgetUrls.settles(send(url, token, null))) WidgetStore.removeTick(app.getFilesDir(), id);
                } else {
                    String url = WidgetUrls.timerUrl(id, server, debuggable), body = WidgetUrls.timerBody(timer, at);
                    if (url != null && body != null && token != null && WidgetUrls.settles(send(url, token, body))) WidgetStore.removeTick(app.getFilesDir(), id, timer, at);
                }
            } catch (Exception ignored) {
                // stays queued: the app sends it when it next opens
            } finally {
                synchronized (IN_FLIGHT) { IN_FLIGHT.remove(id); }
                done.finish();
            }
        });
    }

    /** The POST under one deadline (8 s in all, name lookup included), so goAsync's time is never overrun; -1 when it runs out. */
    private static int send(String url, String token, String body) {
        Future<Integer> f = WORK.submit(() -> WidgetUrls.post(url, token, body, (SSLSocketFactory) SSLSocketFactory.getDefault(), HttpsURLConnection.getDefaultHostnameVerifier(), 4000));
        try {
            return f.get(8, TimeUnit.SECONDS);
        } catch (Exception e) {
            f.cancel(true);
            return -1;
        }
    }

    private static String now() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }
}
