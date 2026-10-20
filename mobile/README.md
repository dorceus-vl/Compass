# Compass on iPhone, iPad and Android (Capacitor 8)

A shell around https://compass.knocturnlabs.com: nothing of the app is bundled except `www/offline.html`. The native side
(`ios/App/App/`, `android/app/src/main/java/com/knocturnlabs/compass/`) adds what the page can't do itself; `web/src/native.ts` is
its caller. Both platforms follow the same rules.

| File | What |
|---|---|
| `CompassNative.swift` | plugin `CompassNative`: `signIn` (Knocturn ID in the system sheet, PKCE, back at `compass://auth`), `registerPush` (APNs token, `env` development in Debug builds, production otherwise), `takeSharedText`, `openExternal`; events `sharedText`, `notificationTap`; decides every top-level navigation |
| `CompassLink.swift` | the rules: the web view stays on the Compass host, other web pages open in Safari, mailto/tel in their apps, other schemes go nowhere; sign-in only on `https://id.knocturnlabs.com` and back to `compass`; notification taps and universal links only to Compass URLs |
| `CompassViewController.swift` | the bridge (registers the plugin, sends `window.open` through the same rules, turns Compass's downloads into files offered in the share sheet) and the root view (web view below the status bar, on `#050507`) |
| `App.entitlements` | push, `applinks:compass.knocturnlabs.com`, `webcredentials:knocturnlabs.com`, app group `group.com.knocturnlabs.compass` |

Notifications: `CompassPush` is the notification delegate (`ios.handleApplicationNotifications: false` keeps Capacitor's own router
from taking it over). A tap sends the notification's `url` to the page as `notificationTap`, kept until the page listens, so a tap that
starts the app still opens its page. `env` follows the build configuration (Debug: development, Release: production) while
`App.entitlements` says `aps-environment` development; Xcode's Archive and export rewrite that for TestFlight. So test on a device
with a Debug build, and distribute with Archive, not a Release build run from Xcode (that would register a sandbox token as production).

Shared text: the Share Extension (`ios/App/ShareExtension/`, bundle id `com.knocturnlabs.compass.ShareExtension`, iOS 17) takes text or
a URL from the share sheet, writes the title and URL (`ShareText.swift`) to `UserDefaults(suiteName: "group.com.knocturnlabs.compass")`
under the key `sharedText`, says "Added to Compass quick add — open Compass to finish" and closes. The app reads and clears it when it
comes to the front and sends it to the page once, which opens quick add prefilled. `build:sim` signs ad hoc so the simulator applies the
app group (an unsigned build gives the extension and the app separate stores).

## Android

| File | What |
|---|---|
| `CompassNativePlugin.java` | plugin `CompassNative`: `signIn` (Knocturn ID in a Custom Tab, back at `compass://auth`; coming back without an answer is `cancelled`), `registerPush` (FCM token, asks for notifications on Android 13+; `{ unsupported: true }` without `google-services.json`), `takeSharedText` (always `null`: a share goes out at once as `sharedText`), `openExternal`; events `sharedText`, `notificationTap`; decides every top-level navigation (links, redirects, `window.open`) |
| `CompassLink.java` | the same rules as `CompassLink.swift`, plus the share text (a browser's title, then its URL) and safe download names; `npm test` checks it with `javac` alone |
| `CompassDownloads.java` | downloads: Compass's Blob downloads (reports, exports) and Compass-host attachments go to the native side in 512 KB parts and the system's Save dialog asks where; other hosts never download |
| `CompassMessaging.java` | FCM in front: shows the message like Android does in the background, so a tap opens its `url` the same way |
| `MainActivity.java` | registers the plugin, WebAuthn in the web view for the app (passkey step-up), and never handles an intent twice (restore, Recents) |
| `AndroidManifest.xml` | `compass://auth`, App Links for `https://compass.knocturnlabs.com` (`autoVerify`), share `text/plain`, the FCM service |

Push: put the Firebase project's `google-services.json` in `android/app/` (never in git); the build applies Firebase only when it is
there. Notification taps arrive as the `url` extra (Firebase in the background, `CompassMessaging` in front) and wait until the page
listens, so a tap that starts the app still opens its page. A new FCM token reaches Compass when the app next starts (it registers again
silently once push is on).

## Commands (in `mobile/`)

```bash
npm install
npm run build:sim        # cap sync + unsigned simulator build (CODE_SIGNING_ALLOWED=NO) into build/
npm test                 # CompassLink's rules, checked with swiftc and javac alone
npm run build:android    # cap sync android + ./gradlew assembleDebug (Java 21, ANDROID_HOME=~/Library/Android/sdk)
COMPASS_URL=http://localhost:5173 npm run build:sim   # point a build at local dev (npm run dev:worker + npm run dev at the root)
npm run open             # syncs the production URL, then opens Xcode, for signing and installing on a device
```

Android against local dev: `adb reverse tcp:5173 tcp:5173`, then `COMPASS_URL=http://localhost:5173 npm run build:android` and
`adb install -r android/app/build/outputs/apk/debug/app-debug.apk` (localhost, not 10.0.2.2: only localhost is a secure context, which
sign-in's PKCE and the dev sign-in need). Cleartext is allowed only in such a build. Rebuild without `COMPASS_URL` before installing it
anywhere else.

Install on a simulator: `xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app`, then
`xcrun simctl launch booted com.knocturnlabs.compass`. Rebuild without `COMPASS_URL` (or `npm run open`, which syncs first) before anything that is not a local test: the generated
`ios/App/App/capacitor.config.json` keeps the last URL.

The project uses CocoaPods (Xcode 27's Swift Package resolver hangs on Capacitor's binary framework). Signing is automatic with team
K948BT44PM; a device build needs your Apple account in Xcode (Settings, Accounts). The app icon is the 512 px Knocturn badge upscaled to
1024 px; replace `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` with a 1024 px original when there is one.
