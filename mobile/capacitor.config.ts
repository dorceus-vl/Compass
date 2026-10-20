import type { CapacitorConfig } from '@capacitor/cli';

// Compass's app is the live site plus same-origin /api behind an HttpOnly cookie: bundled into the app it would have no /api and no
// cookie. So the native app is a shell around compass.knocturnlabs.com (always the current build); nothing is bundled but the offline
// page. The native side (ios/App/App/CompassNative.swift, android/app/src/main/java/com/knocturnlabs/compass/CompassNativePlugin.java)
// adds sign-in in the system sheet or a Custom Tab, push, shared text, downloads and the link rules.
// COMPASS_URL points a build at another server for local tests, e.g. COMPASS_URL=http://localhost:5173 npm run build:sim (Android:
// npm run build:android, with `adb reverse tcp:5173 tcp:5173` so the emulator's localhost is this Mac's; cleartext is allowed only then).
const url = process.env.COMPASS_URL ?? 'https://compass.knocturnlabs.com';

const config: CapacitorConfig = {
  appId: 'com.knocturnlabs.compass',
  appName: 'Compass',
  webDir: 'www',
  server: { url, errorPath: 'offline.html', allowNavigation: [new URL(url).hostname], cleartext: url.startsWith('http:') },
  // 'never': the page pads for the notch and the home bar itself (viewport-fit=cover, env(safe-area-inset-*)).
  // handleApplicationNotifications false: Capacitor's own notification router would replace CompassPush as the notification delegate
  // (it has no handlers here), and taps and in-app banners would do nothing.
  ios: { contentInset: 'never', backgroundColor: '#050507', appendUserAgent: 'CompassApp', handleApplicationNotifications: false },
  android: { backgroundColor: '#050507', appendUserAgent: 'CompassApp' },
  // style DARK: light status bar icons on Compass's dark ground (Android draws the page under the bars; iOS's root sets the same).
  plugins: { SystemBars: { initialViewportFitValueHint: 'cover', style: 'DARK' } },
};

export default config;
