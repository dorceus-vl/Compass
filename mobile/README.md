# Compass on iPhone and iPad (Capacitor 8)

A shell around https://compass.knocturnlabs.com: nothing of the app is bundled except `www/offline.html`. The native side
(`ios/App/App/`) adds what the page can't do itself; `web/src/native.ts` is its caller.

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

Shared text (Task 4's Share Extension): write the text to `UserDefaults(suiteName: "group.com.knocturnlabs.compass")` under the key
`sharedText`. The app reads and clears it when it comes to the front and sends it to the page once.

## Commands (in `mobile/`)

```bash
npm install
npm run build:sim        # cap sync + unsigned simulator build (CODE_SIGNING_ALLOWED=NO) into build/
npm test                 # CompassLink's rules, checked with swiftc alone
COMPASS_URL=http://localhost:5173 npm run build:sim   # point a build at local dev (npm run dev:worker + npm run dev at the root)
npm run open             # syncs the production URL, then opens Xcode, for signing and installing on a device
```

Install on a simulator: `xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app`, then
`xcrun simctl launch booted com.knocturnlabs.compass`. Rebuild without `COMPASS_URL` (or `npm run open`, which syncs first) before anything that is not a local test: the generated
`ios/App/App/capacitor.config.json` keeps the last URL.

The project uses CocoaPods (Xcode 27's Swift Package resolver hangs on Capacitor's binary framework). Signing is automatic with team
K948BT44PM; a device build needs your Apple account in Xcode (Settings, Accounts). The app icon is the 512 px Knocturn badge upscaled to
1024 px; replace `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` with a 1024 px original when there is one.
