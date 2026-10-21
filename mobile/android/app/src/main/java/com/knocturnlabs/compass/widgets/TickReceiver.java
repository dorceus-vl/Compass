package com.knocturnlabs.compass.widgets;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import com.getcapacitor.CapConfig;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A widget's tick circle (A4, the twin of MarkDoneIntent on iOS). Not exported: only the app's own PendingIntents reach it. The task leaves
 * the widget at once (the snapshot is rewritten and every widget redrawn) and the tick is queued in pending-ticks.json. Then, with the
 * token from WidgetToken, it POSTs https://compass.knocturnlabs.com/api/widget/tasks/<id>/done (8 seconds in all, redirects never
 * followed); a 200 drops the queued tick. No token, or any other answer, leaves it queued for the app (takeWidgetTicks, offline queue).
 */
public final class TickReceiver extends BroadcastReceiver {
    static final String ACTION = "com.knocturnlabs.compass.widgets.TICK";
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    /** The tick for one task: an explicit, immutable broadcast to this receiver; the task id is the data (so each row has its own). */
    static PendingIntent intent(Context c, String id) {
        Intent i = new Intent(c, TickReceiver.class).setAction(ACTION).setData(Uri.fromParts("compass-tick", id, null));
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        Uri data = intent.getData();
        String id = ACTION.equals(intent.getAction()) && data != null && "compass-tick".equals(data.getScheme()) ? data.getSchemeSpecificPart() : null;
        if (!WidgetStore.validId(id)) return;
        Context app = context.getApplicationContext();
        PendingResult done = goAsync();
        WORK.execute(() -> {
            try {
                try { WidgetStore.tick(app.getFilesDir(), id, now()); } catch (Exception ignored) { /* the post below still runs */ }
                WidgetProviders.refreshAll(app);
                boolean debuggable = (app.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
                String server = WidgetUrls.server(CapConfig.loadDefault(app).getServerUrl(), debuggable);
                String url = WidgetUrls.doneUrl(id, server, debuggable), token = WidgetToken.read(app);
                if (url != null && token != null && WidgetUrls.settles(post(url, token))) WidgetStore.removeTick(app.getFilesDir(), id);
            } catch (Exception ignored) {
                // stays queued: the app sends it when it next opens
            } finally {
                done.finish();
            }
        });
    }

    /** POST with the bearer token and no body; the status, or -1 with no answer. */
    static int post(String url, String token) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(0);
            c.getOutputStream().close();
            return c.getResponseCode();
        } catch (Exception e) {
            return -1;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String now() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }
}
