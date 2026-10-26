# Compass on iPhone, iPad and Android (Capacitor 8)

A shell around https://compass.knocturnlabs.com: nothing of the app is bundled except `www/offline.html` (and a placeholder `www/index.html`). The native side
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

Widgets (v2.3): the `CompassWidgets` extension (`ios/App/CompassWidgets/`, bundle id `com.knocturnlabs.compass.widgets`, iOS 17, WidgetKit
and App Intents) draws Today, Quick add, Ask Athena (each small widget is one tap target), Project pulse, the Lock Screen widgets and the iPad's This week from the snapshot the page writes
into the app group (`widget-snapshot.json`); it never reads the network. Its tick circles mark the task done in that file at once and queue
the tick in `pending-ticks.json`, which the app sends when it next opens. `WidgetStore.swift` (in `ios/App/App/`) is compiled into both
targets. Taps are `https://compass.knocturnlabs.com/...` links, routed in-app by the scene delegate and `CompassLink`. While "Hide work titles on the Lock Screen" is on, work titles and work project names are
`privacySensitive`, so iOS redacts them on a locked device (StandBy, the Lock Screen); the Lock Screen widgets show "Work task".

Android widgets (v2.3 Task 2b, `android/app/src/main/java/com/knocturnlabs/compass/widgets/`): the same designs as classic App Widgets
(`AppWidgetProvider` and `RemoteViews`, no extra library): Today (2x2, 4x2 with ticks, 4x4 by horizon), Quick add and Ask Athena (1x1),
Project pulse (4x2; touch and hold the widget to pick its project) and This week (5x3 and up, resizable, for tablets). They read
`widget-snapshot.json` in the app's private files, written by `CompassNative.updateWidgets`; Home Screen only (no lock screen widget).
A tick marks the task done in that file, queues it in `pending-ticks.json` and posts it with the tick token (`setWidgetToken`, sealed under
an Android Keystore key) to `https://compass.knocturnlabs.com` only, over a plain TLS socket so the web view's cookies never go with it;
anything but a 200 leaves it queued for the app. A tap opens the app on a Compass link (`CompassLink.open`). Widgets redraw when the app
writes a snapshot, after a tick, every 30 minutes, and at local midnight (one inexact alarm, no alarm permission), where a snapshot from
yesterday says "open Compass to update". Their pure Java (snapshot, URLs, the tick request, files, token sealing) is checked by `npm test`
with the SDK's own `org.json` sources: install "Android SDK Platform Sources" (`sources/android-*`) in the SDK Manager, or the check stops.

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

Prerequisites: Xcode with CocoaPods (iOS), JDK 21 and the Android SDK at `~/Library/Android/sdk` (`ANDROID_HOME`), Node.

```bash
npm install
npm run build:sim        # cap sync + ad hoc signed simulator build (CODE_SIGN_IDENTITY=-) into build/
npm test                 # CompassLink's rules, checked with swiftc and javac alone
npm run build:android    # cap sync android + ./gradlew assembleDebug (Java 21, ANDROID_HOME=~/Library/Android/sdk)
COMPASS_URL=http://localhost:5173 npm run build:sim   # point a build at local dev (npm run dev:worker + npm run dev at the root)
npm run open             # syncs the production URL, then opens Xcode, for signing and installing on a device
```

Android against local dev: `~/Library/Android/sdk/platform-tools/adb reverse tcp:5173 tcp:5173`, then `COMPASS_URL=http://localhost:5173 npm run build:android` and
`~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk` (localhost, not 10.0.2.2: only localhost is a secure context, which
sign-in's PKCE and the dev sign-in need). Cleartext is allowed only in such a build. Rebuild without `COMPASS_URL` before installing it
anywhere else.

Install on a simulator: `xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app`, then
`xcrun simctl launch booted com.knocturnlabs.compass`. Rebuild without `COMPASS_URL` (or `npm run open`, which syncs first) before anything that is not a local test: the generated
`ios/App/App/capacitor.config.json` keeps the last URL.

The project uses CocoaPods (Xcode 27's Swift Package resolver hangs on Capacitor's binary framework). Signing is automatic with team
K948BT44PM; a device build needs your Apple account in Xcode (Settings, Accounts). The app icon is the 512 px Knocturn badge upscaled to
1024 px; replace `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` with a 1024 px original when there is one.

## Install on a device

iPhone or iPad (Debug build, so the push token is a development one):
1. `npm install && npm run open` (syncs the production URL, opens Xcode).
2. Xcode, Settings, Accounts: sign in with the Apple account of team K948BT44PM. Select the `App` target and `ShareExtension`: "Automatically manage signing" is on; Xcode registers `com.knocturnlabs.compass` and `com.knocturnlabs.compass.ShareExtension` and the app group `group.com.knocturnlabs.compass` the first time. Do the same for `CompassWidgets` (`com.knocturnlabs.compass.widgets`): in Apple Developer its App ID needs the App Group `group.com.knocturnlabs.compass` (as for the Share Extension), and the app and the widgets share the Keychain group `K948BT44PM.com.knocturnlabs.compass.shared` (Keychain Sharing, already in both entitlements files).
3. Pick the device (trust the Mac on it, turn on Developer Mode), press Run. Distribute with Product, Archive, not a Release run.

Android (USB debugging on; `~/Library/Android/sdk/platform-tools/adb devices` lists the phone):
1. `npm run build:android` (a production sync, then `assembleDebug`).
2. `~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
3. Push needs Vlad's `google-services.json` in `android/app/` before the build (never committed).

A release build (`cd android && ./gradlew assembleRelease`) is an unsigned APK until a release keystore and `signingConfig` exist; it runs `checkReleaseConfig` first and fails unless `capacitor.config.json` says
`https://compass.knocturnlabs.com` with cleartext off, which a sync after a `COMPASS_URL` build would break: run `npm run sync` (no
`COMPASS_URL`) first. Keystores (`*.jks`, `*.keystore`) are git-ignored; a release key's SHA-256 also goes into `web/public/.well-known/assetlinks.json`.

## Device checklist (Task 7, once deployed)

Everything below was only reasoned from code or seen on a simulator/emulator; do it on the real devices.

Both platforms
- Sign in: the system sheet / Custom Tab opens Knocturn ID, the passkey works, the app lands on Today; closing the sheet leaves the button usable.
- Settings, Notifications on: permission prompt; `POST /api/push/test` arrives (iPhone: Debug build, APNs development token; Android: needs `google-services.json`).
- Tap a notification with the app in front, in the background and killed: each opens its page in place, keeping `?search#hash`.
- Share from Safari/Chrome to Compass: quick add opens prefilled, once.
- Report Word/Markdown and a document download: the share sheet (iOS) or the Save dialog (Android) offers the file.
- A link to another site opens in the browser and the app stays on Compass; mailto and tel open their apps.
- Airplane mode: the offline page shows, "Try again" returns when back online.
- Passkey step-up (export, Empty Trash) works in the web view.

iOS only
- Universal link `https://compass.knocturnlabs.com/...` opens the app (needs `/.well-known/apple-app-site-association` deployed).
- The share extension writes to the app group (signed build) and the app picks the text up.
- iPad: Today, Report download popover, sign-in sheet.
- `shouldOverrideLoad` / `window.open` paths in `CompassViewController` (a `target=_blank` Compass link opens in place, others in Safari).

Widgets (v2.3; needs the Worker deployed with migration 0016 for ticking)
- iPhone and iPad, once: register the App ID `com.knocturnlabs.compass.widgets` in Apple Developer with the App Group `group.com.knocturnlabs.compass` and Keychain Sharing (or let Xcode do it on the first signed build of `CompassWidgets`), then build to the device (Install on a device, above). Open Compass once and sign in so a snapshot exists.
- Add the widgets: long-press the Home Screen, Edit, Add Widget, Compass: Today (small, medium, large), Quick add, Ask Athena, Project pulse (Edit Widget picks the project); Lock Screen: inline, circular, rectangular; iPad: This week (extra large). Before the first open they say "Open Compass once to fill this widget".
- Settings, Widgets, "Tick tasks from widgets": turn on, answer the passkey prompt; the device shows under "Devices that can tick". Tick a circle on the medium widget: it fills at once, the task is done in Compass within a few seconds (check the Today screen); in airplane mode it stays ticked and the app sends it when opened. Revoke in Settings and tick again: nothing is sent and the tick waits for the app.
- Taps: a task opens it in the app, the header opens Today, Quick add opens the palette, Ask Athena opens `/athena`, Project pulse opens that project's Dashboard.
- Privacy: with "Hide work titles on the Lock Screen" on, a work task shows "Work task" on the Lock Screen widgets and is redacted in StandBy (and on a locked iPhone's Home Screen); an Offline-only project's task never shows a title. Turn the switch off and a work title shows.
- Android: install the debug build (above), open Compass and sign in, long-press the Home Screen, Widgets, Compass, and add Today (2x2, 4x2, 4x4), Quick add, Ask Athena, Project pulse (pick a project when asked; touch and hold to change) and, on a tablet, This week. Turn on "Tick tasks from widgets" in Settings, Widgets (passkey), tick a circle on the 4x2 Today widget, and check the task is done in Compass. Midnight rollover: leave a device overnight, or change the date and time past midnight; the widgets should read the new day (or say "open Compass to update") without opening the app.

Widget timers (v2.5; needs the Worker deployed with migration 0018 and "Tick tasks from widgets" on)
- Medium and large Today widget (iPhone, and Android 4x2 / 4x4): tap the timer button on a task; it shows running at once and a running entry appears under Time in the app (source widget). Tap Stop: the entry ends.
- A running timer on the Lock Screen widgets shows elapsed time only, never a task title (a work task says "Work task").
- Airplane mode: start a timer from the widget, then stop it; open Compass online: both are sent, the entry starts at the time you tapped Start and ends when you tapped Stop (not when the app opened).
- Airplane mode: start a timer from the widget; turn Airplane mode off, then stop it from the widget: the stop is refused (nothing is running on the server yet), so both stay queued; open Compass: both are sent with the tap times and one entry runs from Start to Stop.
- A project timer (started in the app) shows on the widget without a Stop button; stop it in the app.
- Start a timer from the widget offline, start another on the same task in the app, then go online: the second start is refused with a toast and its queued stop goes with it; one entry remains.

Android only
- Real Knocturn ID round trip on the Samsung: passkey in the Custom Tab, back at `compass://auth`. Passkeys need `https://knocturnlabs.com/.well-known/assetlinks.json` to name the app (deployed in Task 6 Step 4).
- App Link verification (`~/Library/Android/sdk/platform-tools/adb shell pm get-app-links com.knocturnlabs.compass` says verified; needs `https://compass.knocturnlabs.com/.well-known/assetlinks.json` deployed (Task 6 Step 4) and the signing key's fingerprint in it).
- Android 13+: the notification prompt appears only after Settings, Notifications is turned on.
- A release build: `checkReleaseConfig` passes after `npm run sync` and fails after a `COMPASS_URL` sync.
