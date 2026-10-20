# Compass for Mac (Tauri 2)

A menu-bar app around https://compass.knocturnlabs.com: nothing of the app is bundled (a blank window if the site can't load). `web/src/native.ts` is its caller.

| File | What |
|---|---|
| `src-tauri/src/lib.rs` | the main window (the live site), the menu-bar icon (Open Compass, Quick add ⌥⇧C, Launch at login, Quit), the quick-add window (`/?quickadd=1`, always on top), `compass://auth` → event `compass-auth` to the main window, banners, downloads; commands `open_external`, `notify_permission`, `notify`, `close_quick_add` |
| `src-tauri/src/notify.rs` | banners through UNUserNotificationCenter: `notify_permission` asks macOS and answers the real result; each banner carries its url, a click opens it in the main window; banners show while Compass is in front too |
| `src-tauri/src/link.rs` | the rules (`cargo test`): the windows stay on the Compass host, other pages open in the default browser, mailto/tel in their apps, other schemes nowhere; sign-in comes back only as exactly `compass://auth`; banner clicks and downloads only from Compass; safe, never-overwriting download names |
| `src-tauri/capabilities/` | only `https://compass.knocturnlabs.com/*` may call the commands and listen to events (main window), and close itself (quick-add window). A `COMPASS_URL` build adds the same for that origin at start |

Closing the window hides it (no Dock icon while hidden); Quit in the menu (or ⌘Q) ends the app. Launch at login starts it hidden
(a LaunchAgent with `--hidden`). Banners: the signed-in page reads `GET /api/push/outbox` every minute while Notifications are on
in Settings (ruling N3) and hands each item to `notify`; a click opens its url in the main window. Reports, exports and attachments
download into ~/Downloads and are shown in Finder; the status report prints through the macOS print panel (Save as PDF). A passkey
step-up the Mac app can't run offers the same page in the browser. A local build started with `COMPASS_BANNER_TEST=1`
(`Compass.app/Contents/MacOS/compass`) asks for notifications and posts one test banner, logging to stderr.

Prerequisites: Rust (cargo) and Node; the first build downloads the crates.

```bash
npm install
npm test                                             # link.rs rules
npm run build                                        # src-tauri/target/release/bundle/macos/Compass.app, signed "Apple Development"
COMPASS_URL=http://localhost:5173 npm run build      # a local build (npm run dev:worker + npm run dev at the root); rebuild without it after
APPLE_SIGNING_IDENTITY=- npm run build               # ad hoc, without the certificate
npm run icons                                        # app icons from the badge (keep icon.icns, 32x32, 128x128, 128x128@2x, icon.png)
```

The menu-bar image is `icons/tray-template.png` (44 px template, from `tray-icon.swift`). Not notarized (ruling N6): copy
`Compass.app` to /Applications on this Mac; `compass://` works once macOS has seen the app there.

## Install on this Mac

1. `npm install && npm run build` (signs with "Apple Development" if that certificate is in the keychain; `APPLE_SIGNING_IDENTITY=- npm run build` signs ad hoc).
2. Open `src-tauri/target/release/bundle/macos/Compass.app` once to try it, then copy it to /Applications (`compass://` works after macOS has seen it there; it is not notarized).
3. Allow notifications when asked. Sign in from the window: the browser opens Knocturn ID and hands back to the app.

## Device checklist (Task 7, once deployed)

The Mac UI was never driven in an automated run (no Screen Recording or Accessibility access); do all of it by hand.

- The menu-bar icon shows Open Compass, Quick add ⌥⇧C, Launch at login, Quit; closing the window hides it and Open Compass brings it back.
- Sign in: the default browser opens Knocturn ID, the passkey works, `compass://auth` returns to the app and the main window lands on Today.
- ⌥⇧C opens the quick-add window; Add closes it and the task appears; Escape closes it.
- Allow notifications; Settings, Notifications on; `POST /api/push/test` gives a banner within 60 s, with Compass hidden and with it frontmost (a hidden window's poll may be throttled: if so, a Rust timer is the fix). A click opens its url in the main window.
- Launch at login toggles and starts the app hidden.
- Report Word/Markdown/export lands in ~/Downloads and is revealed in Finder; status report, Print, Save as PDF.
- Export or Empty Trash shows "Continue in your browser" and opens the page in the default browser (the Mac app cannot run the passkey step-up yet).
- `compass://` returns to the app only once Compass.app is in /Applications and has been opened there (macOS registers the handler then): check sign-in from that copy.
- A link to another site opens in the default browser; the window stays on Compass.
- The IPC rules: the commands work from compass.knocturnlabs.com (menu, banners, sign-in).
- With the site unreachable the window is blank (no offline page on the Mac yet).
