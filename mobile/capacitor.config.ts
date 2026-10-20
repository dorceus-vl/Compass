import type { CapacitorConfig } from '@capacitor/cli';

// Compass's app is the live site plus same-origin /api behind an HttpOnly cookie: bundled into the app it would have no /api and no
// cookie. So the native app is a shell around compass.knocturnlabs.com (always the current build); nothing is bundled but the offline
// page. The native side (ios/App/App/CompassNative.swift) adds sign-in in the system sheet, push, shared text and the link rules.
// COMPASS_URL points a build at another server for local tests, e.g. COMPASS_URL=http://localhost:5173 npm run build:sim.
const url = process.env.COMPASS_URL ?? 'https://compass.knocturnlabs.com';

const config: CapacitorConfig = {
  appId: 'com.knocturnlabs.compass',
  appName: 'Compass',
  webDir: 'www',
  server: { url, errorPath: 'offline.html', allowNavigation: [new URL(url).hostname] },
  // 'never': the page pads for the notch and the home bar itself (viewport-fit=cover, env(safe-area-inset-*)).
  ios: { contentInset: 'never', backgroundColor: '#050507', appendUserAgent: 'CompassApp' },
  android: { backgroundColor: '#050507', appendUserAgent: 'CompassApp' },
  plugins: { SystemBars: { initialViewportFitValueHint: 'cover' } },
};

export default config;
