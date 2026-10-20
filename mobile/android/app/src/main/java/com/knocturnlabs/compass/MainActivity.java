package com.knocturnlabs.compass;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.net.URI;

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
        // Capacitor's own client grants every capture request from any page; this one passes on only the Compass page's mic (still
        // created during onCreate, as its activity-result launchers must be).
        getBridge().getWebView().setWebChromeClient(new CompassChromeClient(getBridge()));
    }

    /** Capacitor's web chrome client (dialogs, file chooser, the RECORD_AUDIO prompt) with capture limited by CompassLink.mayCapture. */
    static final class CompassChromeClient extends BridgeWebChromeClient {
        private final Bridge bridge;

        CompassChromeClient(Bridge bridge) { super(bridge); this.bridge = bridge; }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            if (CompassLink.mayCapture(String.valueOf(request.getOrigin()), request.getResources(), URI.create(bridge.getAppUrl()))) super.onPermissionRequest(request);
            else request.deny();
        }
    }
}
