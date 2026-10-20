# Compass for Mac (Tauri 2)

A menu-bar app around https://compass.knocturnlabs.com: nothing of the app is bundled. `web/src/native.ts` is its caller.

| File | What |
|---|---|
| `src-tauri/src/lib.rs` | the main window (the live site), the menu-bar icon (Open Compass, Quick add ⌥⇧C, Launch at login, Quit), the quick-add window (`/?quickadd=1`, always on top), `compass://auth` → event `compass-auth` to the main window, banners, downloads; commands `open_external`, `notify_permission`, `notify`, `close_quick_add` |
| `src-tauri/src/link.rs` | the rules (`cargo test`): the windows stay on the Compass host, other pages open in the default browser, mailto/tel in their apps, other schemes nowhere; sign-in comes back only as exactly `compass://auth`; banner clicks and downloads only from Compass; safe, never-overwriting download names |
| `src-tauri/capabilities/` | only `https://compass.knocturnlabs.com/*` may call the commands and listen to events (main window), and close itself (quick-add window). A `COMPASS_URL` build adds the same for that origin at start |

Closing the window hides it (no Dock icon while hidden); Quit in the menu (or ⌘Q) ends the app. Launch at login starts it hidden
(a LaunchAgent with `--hidden`). Banners: the signed-in page reads `GET /api/push/outbox` every minute while Notifications are on
in Settings (ruling N3) and hands each item to `notify`; a click opens its url in the main window. Reports, exports and attachments
download into ~/Downloads and are shown in Finder.

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
