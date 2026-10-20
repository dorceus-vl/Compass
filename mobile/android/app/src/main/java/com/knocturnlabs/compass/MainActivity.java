package com.knocturnlabs.compass;

import android.content.Intent;
import android.os.Bundle;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Capacitor hands the launch intent to CompassNative (a share, a notification tap, an App Link, a sign-in answer). One already
        // handled must not be handled again when Android restores the activity or relaunches it from Recents.
        if (savedInstanceState != null || (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            setIntent(new Intent(Intent.ACTION_MAIN));
        }
        registerPlugin(CompassNativePlugin.class); // it lives in the app, not in an npm package
        super.onCreate(savedInstanceState);
        // Passkeys inside the web view (Compass's step-up): Android's web view has WebAuthn off unless the app turns it on. FOR_APP runs
        // it as this app, so knocturnlabs.com's Digital Asset Links must name com.knocturnlabs.compass (N5). Sign-in itself is a Custom Tab.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(getBridge().getWebView().getSettings(), WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);
        }
    }
}
