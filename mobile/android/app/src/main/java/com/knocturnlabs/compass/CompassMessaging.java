package com.knocturnlabs.compass;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Push on Android (only runs in a build with google-services.json). With the app in the background Android shows Compass's message
 * itself, and its tap opens MainActivity with the message's data (`url`) as extras. With the app in front the message comes here
 * instead; it is shown the same way, so a tap works the same. A new token reaches Compass when the page next starts (it registers
 * again silently once push is on).
 */
public class CompassMessaging extends FirebaseMessagingService {
    static final String CHANNEL = "compass";

    static void channel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Compass", NotificationManager.IMPORTANCE_HIGH);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        RemoteMessage.Notification n = message.getNotification();
        if (n == null || !NotificationManagerCompat.from(this).areNotificationsEnabled()) return;
        channel(this);
        String url = message.getData().get("url");
        Intent open = new Intent(this, MainActivity.class).putExtra("url", url).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int id = n.getTag() != null ? 0 : (int) SystemClock.uptimeMillis(); // a tag replaces its earlier message, as in the background
        PendingIntent tap = PendingIntent.getActivity(this, url == null ? 0 : url.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder note = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(this, R.color.compass_accent))
            .setContentTitle(n.getTitle())
            .setContentText(n.getBody())
            .setStyle(new NotificationCompat.BigTextStyle().bigText(n.getBody()))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tap);
        try {
            NotificationManagerCompat.from(this).notify(n.getTag(), id, note.build());
        } catch (SecurityException ignored) {
            // notifications were turned off between the check and here
        }
    }
}
