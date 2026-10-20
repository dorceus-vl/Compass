# Compass Phase 4 (Native apps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compass runs as a real app on iPhone, iPad, Android and the Mac: signed in through Knocturn ID's system sheet with passkeys, native push notifications (Apple push on iPhone and iPad, Firebase on Android, native banners on the Mac), sharing text or a link from any app into quick add, links to compass.knocturnlabs.com opening the app, and on the Mac a menu-bar quick add on a global shortcut.

**Architecture:** The phone and tablet apps are a Capacitor 8 shell whose web view loads the live site (`server.url`), copied from Aura's `mobile/` layout, plus one small native plugin (`CompassNative`: sign-in sheet, push registration, shared-text hand-off). Sign-in follows Health's proven pattern: the page builds a PKCE request, the plugin opens Knocturn ID in the system sheet (`ASWebAuthenticationSession` on iOS, a Custom Tab on Android), the sheet returns to `compass://auth`, and the Worker trades the code for the normal HttpOnly session at `POST /api/auth/native`. The Mac app is a Tauri 2 menu-bar app (Kelly-App's pattern) that loads the live site, signs in through the default browser and the same `compass://auth` deep link, and shows native banners. The Worker gains device push: a `kind` on subscriptions, an Apple push sender (Kelly-Cloud's token-based sender, topic per app), a Firebase HTTP v1 sender (Hollow's), and a small outbox the Mac app reads.

**Tech Stack:** Capacitor 8.5 (`@capacitor/core`, `cli`, `ios`, `android`), CocoaPods for iOS (Xcode 27's package resolver hangs on Capacitor's binary framework, per Aura), Swift and Java for the plugin; Tauri 2.11 (Rust) with `tauri-plugin-deep-link`, `tauri-plugin-notification`, `tauri-plugin-global-shortcut`, `tauri-plugin-autostart`, `tauri-plugin-opener`; Worker additions in TypeScript with no new npm dependency.

**Spec:** `docs/superpowers/specs/2026-10-19-compass-design.md` §9 (APNs, the shells register tokens with `POST /push/subscribe`), §11 (Mac: Tauri, menu-bar quick add, global hotkey, native notifications; iPhone/iPad/Android: Capacitor with `server.url` = the site, push, share sheet to quick add, universal links), §13 step 4. Catalogue §12. References (read, don't modify): `~/Documents/Aura/mobile/` (+ `Aura/docs/phone.md`), `~/Documents/Health-Dashboard/.claude/worktrees/ios-app/` (`apple/`, `public/js/login.js`, `src/routes/auth.ts`), `~/Documents/Kelly-App/src-tauri/`, `~/Documents/Kelly-Cloud/src/lib/apns.ts`, `~/Documents/Hollow/web/src/notify.ts` (FCM v1), `~/Documents/Knocturn-ID/INTEGRATION.md` §2, §8d, §11.

## What exists today (verified 2026-10-20)

| Fact | Where |
| --- | --- |
| `compass` is already in Knocturn ID's `APPS` and `PASSKEY_APPS`; `APP_REDIRECTS` is `dictation=sonarflow://auth,hollow=hollow://auth,health=health://auth`; a redirect must match exactly; codes last 120 s, single use | `Knocturn-ID/wrangler.jsonc`, `src/index.ts` (`appRedirect`), INTEGRATION.md §8d |
| Team ID `K948BT44PM`; one signing identity on this Mac: Apple Development (no Distribution, no Developer ID); no provisioning profiles yet; Xcode 27.1, iOS 26.5 simulators; Android SDK 36/37 with an emulator image; Java 21; Rust 1.98; CocoaPods | the Mac |
| Knocturn Labs' passkey trust files live on `knocturnlabs.com` (Knocturnlabs-Landing): AASA lists `webcredentials` for Aura and Night Owl only; `assetlinks.json` lists Night Owl and Aura (debug keystore) | `~/Documents/Knocturnlabs-Landing/public/.well-known/` |
| Kelly-Cloud's Apple push sender hardcodes the topic `com.knocturnlabs.aura`; secrets `APNS_KEY_ID`, `APNS_KEY_P8`, `APPLE_TEAM_ID` | `Kelly-Cloud/src/lib/apns.ts` |
| Hollow's Firebase sender uses FCM HTTP v1 with the `FCM_SERVICE_ACCOUNT` secret; no Firebase project exists yet | `Hollow/web/src/notify.ts` |
| Compass push: Web Push only; `push_subscriptions(endpoint UNIQUE, p256dh NOT NULL, auth NOT NULL, …)` has no kind; `web/src/push.ts` assumes a service worker `PushManager` | `worker/migrations/0003_sources.sql`, `web/src/push.ts` |
| Compass sign-in: `/api/auth/login` + WebAuthn in the page, HttpOnly SameSite=Lax cookie; no native route | `web/src/views/SignIn.tsx`, `worker/routes/auth.ts` |

## Who does what

| # | Only Vlad | When | How long |
| --- | --- | --- | --- |
| 1 | Approve two outside changes before they go live: Knocturn ID gets `compass=compass://auth` in `APP_REDIRECTS` (Task 5), and knocturnlabs.com's trust files list Compass (Task 5) | After Task 5's review | 1 min |
| 2 | Say "deploy Compass" for the Worker changes (Task 6) | After Task 5 | 1 min |
| 3 | Apple push key: put it on the Compass Worker yourself. In Terminal, in `~/Documents/Compass`: `npx wrangler secret put APNS_KEY_P8` (paste the .p8 file's text), `npx wrangler secret put APNS_KEY_ID`, and `APPLE_TEAM_ID` is the var `K948BT44PM` (no secret). You can reuse the key Kelly-Cloud uses (Apple push keys work for every app on the team) or create a new one at developer.apple.com → Keys. | Before Task 6's push test | 5 min |
| 4 | Firebase for Android push: create a Firebase project "Compass" at console.firebase.google.com, add an Android app with package `com.knocturnlabs.compass`, download `google-services.json` into `~/Documents/Compass/mobile/android/app/`, then Project settings → Service accounts → Generate new private key, and `npx wrangler secret put FCM_SERVICE_ACCOUNT` (paste the file's text). Skip this and Android works without push. | Before Task 6's push test | 10 min |
| 5 | Xcode signs in with your Apple account (Xcode → Settings → Accounts) so automatic signing can create the App IDs and profiles for `com.knocturnlabs.compass` (iPhone, iPad, Mac) with push and associated domains | Before Task 7 | 2 min |
| 6 | Connect and unlock the iPhone and the iPad (trust this Mac), and on the Samsung turn on USB debugging; approve the passkey, Face ID and notification prompts in the apps | Task 7 | 10 min |
| 7 | Later and optional: TestFlight needs an Apple Distribution certificate and an App Store Connect record (Aura's `docs/phone.md` has the steps); a shareable Mac app needs a Developer ID certificate. Phase 4 installs straight from this Mac without them. | Any time | 20 min |

## Global Constraints

- Everything from Phases 1–3b holds (tokens, CSP, offline queue, step-up, no hard delete, encrypted work rows, plain text never HTML, reduced motion, 44 px).
- App id `com.knocturnlabs.compass` on iOS, iPadOS, Android and macOS; URL scheme `compass`; Team `K948BT44PM`.
- The shells load `https://compass.knocturnlabs.com` (env `COMPASS_URL` may override it for local testing); nothing of the app is bundled except an offline page. Navigation stays on that host; any other host opens in the system browser.
- Sign-in inside a shell always goes through the system sheet (iOS/Android) or the default browser (Mac) with PKCE and `redirect_uri=compass://auth`; the native side refuses any sign-in URL not on `id.knocturnlabs.com` and any callback scheme other than `compass`.
- `POST /api/auth/native {code, code_verifier}` is the only new unauthenticated route; it creates the same session as `/api/auth/login` and applies `COMPASS_USERS`.
- Push secrets are put by Vlad only (`APNS_KEY_P8`, `APNS_KEY_ID`, `FCM_SERVICE_ACCOUNT`); `APPLE_TEAM_ID` and `APNS_TOPIC` (`com.knocturnlabs.compass`) are vars. Push payload text stays generic for work items (Phase 2 ruling Q8: no work content in pushes).
- Implementers never deploy, put secrets, push to git, publish to a store, deploy outside repos, or install on Vlad's physical devices; simulator and emulator builds are fine.
- No new npm dependency in the Worker or the web app except `@capacitor/*` packages inside `mobile/` and `@tauri-apps/*` inside `mac/` (each folder has its own `package.json`).

## Rulings made while writing this plan

- **N1 Sign-in: Health's system-sheet pattern**, not passkeys inside the web view. It needs no associated-domain webcredentials for the shell, works the same on iOS, Android and the Mac (through `compass://auth`), and keeps the HttpOnly cookie session. Cost if wrong: a later switch to in-view passkeys needs the AASA webcredentials entry (added anyway in N5).
- **N2 Push storage:** migration `0006_device_push.sql` adds `kind` (`web`, `apns`, `fcm`), `env` (`development`, `production`, null) and `platform` (`ios`, `ipados`, `android`, `mac`, `web`) to `push_subscriptions`, makes `p256dh` and `auth` nullable (device tokens have none), and keeps `endpoint` unique (for devices it holds the token). `deliver()` branches by kind.
- **N3 The Mac gets notifications from an outbox, not Apple push.** Tauri has no maintained Apple-push plugin for macOS; the Mac app is a menu-bar app that runs at login, so it reads `GET /api/push/outbox?since=` every 60 seconds while running and shows native banners. A new `push_outbox` table keeps each push's title, body and url for 7 days (generic text for work, as Web Push already does). Cost if wrong: Mac banners arrive up to a minute late and only while the app runs.
- **N4 Share to quick add:** Android receives `ACTION_SEND` text in the main activity; iOS gets a Share Extension that saves the text to the app group `group.com.knocturnlabs.compass` and the app reads it on the next foreground. Both open Compass's quick add (the ⌘K palette) prefilled. On the Mac the global shortcut opens a small quick-add window.
- **N5 Links and trust files:** Compass serves `/.well-known/apple-app-site-association` (`applinks` for `compass.knocturnlabs.com`, all paths) and `/.well-known/assetlinks.json` (`handle_all_urls` for `com.knocturnlabs.compass`); knocturnlabs.com's AASA gains `K948BT44PM.com.knocturnlabs.compass` under `webcredentials` and its `assetlinks.json` gains the Compass package, so a future in-view passkey works too.
- **N6 Distribution in Phase 4 is direct install** from this Mac with the existing Apple Development certificate (iPhone, iPad, Mac) and a signed debug APK on the Samsung. TestFlight, the Play Store and a notarized Mac app are listed for later (Who does what #7), because each needs certificates or accounts that don't exist yet and Apple may reject a web wrapper under guideline 4.2.
- **N7 Mac quick-add shortcut:** ⌥⌘Space would clash with Finder; Compass uses ⌥⇧C, shown and changeable in Settings later (v2).

## File map

| Path | Responsibility |
| --- | --- |
| `worker/migrations/0006_device_push.sql` | push kinds; `push_outbox` |
| `worker/lib/apns.ts`, `worker/lib/fcm.ts` | Senders (pure request builders + send) |
| `worker/lib/notify.ts`, `worker/routes/push.ts`, `worker/routes/auth.ts`, `worker/index.ts` | Branching delivery, `POST /api/push/device`, `GET /api/push/outbox`, `POST /api/auth/native`, `.well-known` files |
| `web/src/native.ts`, `web/src/push.ts`, `web/src/views/SignIn.tsx`, `web/src/ui/Palette.tsx` | Detect the shell, native sign-in, native push, shared text into quick add, external links |
| `mobile/` | Capacitor project: `capacitor.config.ts`, `www/` (offline page), `ios/` (App + `CompassNative.swift` + ShareExtension), `android/` (`CompassNativePlugin.java`, manifest), scripts |
| `mac/` | Tauri 2 project: `src-tauri/` (menu bar, windows, deep link, notifications, outbox poll, autostart), icons |
| `scripts/apns.test.ts`, `scripts/fcm.test.ts`, `scripts/native.test.ts` | Self-checks |

---

### Task 0: Device push and native sign-in on the Worker

**Files:** Create `worker/migrations/0006_device_push.sql`, `worker/lib/apns.ts`, `worker/lib/fcm.ts`, `scripts/apns.test.ts`, `scripts/fcm.test.ts`; modify `worker/lib/notify.ts`, `worker/routes/push.ts`, `worker/routes/auth.ts`, `worker/middleware/auth-guard.ts`, `worker/types.ts`, `wrangler.jsonc`, `worker/routes/trash.ts` (purge the outbox), `shared/types.ts`, `scripts/smoke.sh`, `docs/integration.md` (nothing for senders; skip if unchanged)

**Interfaces (produces):**
- Migration (exact intent; write the SQL): rebuild `push_subscriptions` with `kind TEXT NOT NULL DEFAULT 'web' CHECK (kind IN ('web','apns','fcm'))`, `env TEXT CHECK (env IN ('development','production'))`, `platform TEXT CHECK (platform IN ('web','ios','ipados','android','mac'))`, `p256dh` and `auth` nullable, all existing rows kept as `kind='web', platform='web'`; `CREATE TABLE push_outbox (id TEXT PRIMARY KEY, at TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL)` with an index on `at`.
- `apns.ts`: `apnsJwt(keyP8: string, keyId: string, teamId: string, nowSec: number): Promise<string>` (ES256, cached 40 min); `apnsRequest(token: string, env: 'development'|'production', topic: string, msg: PushMessage, jwt: string): { url: string; init: RequestInit }` (host `api.push.apple.com` or `api.sandbox.push.apple.com`, `/3/device/<token>`, headers `apns-push-type: alert`, `apns-topic`, `apns-priority: 10`, `apns-expiration`, `apns-collapse-id` from `msg.tag`, body `{ aps: { alert: { title, body }, sound: 'default' }, url }`); `sendApns(env, sub, msg): Promise<Sent>` (gone on 410, or 400 with `BadDeviceToken` / `DeviceTokenNotForTopic` / `Unregistered`).
- `fcm.ts`: `fcmJwt(serviceAccountJson, nowSec)` (RS256, scope `https://www.googleapis.com/auth/firebase.messaging`, exchanged at `oauth2.googleapis.com/token`, access token cached 50 min); `fcmRequest(projectId, accessToken, token, msg)` (`POST https://fcm.googleapis.com/v1/projects/<id>/messages:send`, body `{ message: { token, notification: { title, body }, data: { url }, android: { priority: 'high', notification: { tag } } } }`); `sendFcm(env, sub, msg): Promise<Sent>` (gone on 404 `UNREGISTERED`).
- `deliver()` sends by `kind`; a missing secret for a kind counts as `local` (not the device's fault), never as failed; every delivered message is also written to `push_outbox` (one row per message, not per device), purged after 7 days in `purgeAudit`.
- Routes: `POST /api/push/device { kind: 'apns'|'fcm', token, env?, platform, device_name? }` (token `^[0-9a-f]{64}$` for apns, 20–4096 chars `[A-Za-z0-9_:\-]` for fcm; upsert on the token; the same 20-device cap); `GET /api/push/outbox?since=<iso>` → `{ items: { id, at, title, body, url }[] }` (newest 50 after `since`, session-gated); `POST /api/auth/native { code, code_verifier }` → Knocturn ID `/v1/auth/token` over the `ID` binding with the PKCE verifier, then the same session creation and `COMPASS_USERS` check as `/login` (rejects with the same messages); added to the auth guard's public list and exempt from the same-origin check only for this route? No: the shell's web view is on the same origin, so keep the same-origin check.
- `wrangler.jsonc` vars: `APPLE_TEAM_ID: "K948BT44PM"`, `APNS_TOPIC: "com.knocturnlabs.compass"`; `Env` gains `APNS_KEY_P8?`, `APNS_KEY_ID?`, `APPLE_TEAM_ID`, `APNS_TOPIC`, `FCM_SERVICE_ACCOUNT?`.

- [ ] **Step 1: Failing tests.** `scripts/apns.test.ts`: with a generated P-256 key (WebCrypto), `apnsJwt` has header `{alg:'ES256',kid}` and claims `{iss:teamId,iat:nowSec}`, and verifies with the public key; `apnsRequest` builds the sandbox and production URLs, the topic and collapse-id headers, and the body exactly. `scripts/fcm.test.ts`: with a generated RSA key in a fake service-account JSON, `fcmJwt`'s assertion verifies, has `iss`, `aud: https://oauth2.googleapis.com/token`, the scope, `exp = iat + 3600`; `fcmRequest` builds the URL and body exactly; a work message passes through unchanged (callers already make it generic).
- [ ] **Step 2:** Implement until they pass, porting Kelly-Cloud's and Hollow's senders (topic from `APNS_TOPIC`, not hardcoded).
- [ ] **Step 3:** Migration (apply locally), `deliver()` branching, outbox, routes, auth-guard entry for `/api/auth/native` only.
- [ ] **Step 4: Smoke:** register a fake apns and fcm token (no secrets locally → `deliver` records them as `local`, not failed or deleted); `POST /api/push/test` → `GET /api/push/outbox` lists it; `POST /api/auth/native` with a bad code → 401 with Knocturn ID's message (dev Knocturn ID unreachable locally is acceptable as 502; state which).
- [ ] **Step 5: Commit** `Phase 4 Task 0: device push and native sign-in on the Worker`.

---

### Task 1: The web app inside a shell

**Files:** Create `web/src/native.ts`, `scripts/native.test.ts`; modify `web/src/push.ts`, `web/src/views/SignIn.tsx`, `web/src/ui/Palette.tsx` (prefill), `web/src/views/Settings.tsx` (notifications section), `web/src/App.tsx`

**Interfaces:** `native.ts`: `shell(): 'ios' | 'android' | 'mac' | null` (Capacitor `window.Capacitor?.isNativePlatform()` + `getPlatform()`, or Tauri `window.__TAURI_INTERNALS__`); `pkce(): Promise<{ verifier: string; challenge: string; state: string }>` (pure, WebCrypto; tested); `signInUrl(o: { challenge; state; deviceId; deviceName; platform })` (pure: `https://id.knocturnlabs.com/?app=compass&redirect_uri=compass://auth&code_challenge=…&code_challenge_method=S256&state=…&device_id=…&device_name=…&platform=…`; tested); `nativeSignIn(): Promise<void>` (Capacitor: `CompassNative.signIn({ url, callbackScheme: 'compass' })` → returned URL; Tauri: opens the URL in the default browser and waits for the `compass-auth` event carrying the callback URL; checks `state`, posts `/api/auth/native`, reloads); `registerNativePush(): Promise<'granted'|'denied'|'unsupported'>` (Capacitor: `CompassNative.registerPush()` → `{ kind, token, env }` → `POST /api/push/device`; Tauri: asks notification permission, nothing to register (outbox)); `onSharedText(cb)` (Capacitor `CompassNative` event `sharedText` + `takeSharedText()` on start); `openExternal(url)`.

- [ ] **Step 1:** `scripts/native.test.ts` for `pkce` (verifier 43–128 chars of the unreserved set; challenge = base64url SHA-256 of the verifier) and `signInUrl` (exact query, encoded). Implement `native.ts`.
- [ ] **Step 2: Sign-in:** in a shell, SignIn shows one primary button "Sign in with Knocturn ID" (the password form stays reachable under "Use password instead" for the web view only on Android, where in-view passkeys work through Aura's `WEB_AUTHENTICATION_SUPPORT_FOR_APP`); errors show in place.
- [ ] **Step 3: Push:** `push.ts` routes to `registerNativePush` in a shell; Settings → Notifications shows the device type ("This iPhone", "This Mac") and the same test button.
- [ ] **Step 4: Shared text:** a shared text or URL opens the palette in quick-add mode with the text prefilled (a URL becomes the task title "Read: <host>" with the URL in notes? No: the raw text as the title, the URL kept in notes when the text is a URL — test this mapping as a pure function).
- [ ] **Step 5: External links:** in a shell, any link to another host opens through `openExternal`; deep links into `compass.knocturnlabs.com/<path>` navigate in place.
- [ ] **Step 6:** In a plain browser nothing changes (screenshots of SignIn and Settings at 375 / 1280 unchanged except Settings' device label). **Commit** `Phase 4 Task 1: web app in a shell`.

---

### Task 2: iPhone and iPad app (Capacitor, iOS)

**Files:** Create `mobile/` (`package.json`, `capacitor.config.ts`, `www/index.html`, `www/offline.html`, `ios/…` via `npx cap add ios --packagemanager CocoaPods`), `mobile/ios/App/App/CompassNative.swift`, `CompassViewController.swift`, `App.entitlements`, `mobile/README.md`

- [ ] **Step 1:** Scaffold from Aura's `mobile/` (config, scripts `sync`, `open`, `build:sim`, the offline page, the safe-area and dark background settings, `allowNavigation` for the site host only), app id `com.knocturnlabs.compass`, name "Compass", `appendUserAgent: CompassApp`, deployment target 17.0, iPhone and iPad.
- [ ] **Step 2: `CompassNative.swift`** (registered in the view controller as Aura does): `signIn({ url, callbackScheme })` via `ASWebAuthenticationSession` (`prefersEphemeralWebBrowserSession = false`), refusing a URL not on `id.knocturnlabs.com` or a scheme other than `compass` (Health's `HealthAuthPlugin.swift` is the reference); `registerPush()` (asks permission, `registerForRemoteNotifications`, resolves `{ kind: 'apns', token: hex, env: DEBUG ? 'development' : 'production' }` — Aura's `AuraPush.swift`); tapping a notification navigates the web view to its `url` if it is on the Compass host (Aura's `AuraLink` allowlist pattern); `takeSharedText()` reads and clears the app group's shared text.
- [ ] **Step 3: Entitlements:** push (`aps-environment`), associated domains `applinks:compass.knocturnlabs.com` and `webcredentials:knocturnlabs.com`, app group `group.com.knocturnlabs.compass`; URL type `compass`.
- [ ] **Step 4: Icons and launch screen** from `assets/brand/compass-logo.png` (the ivory badge) on the `--bg` colour; all required sizes generated with `sips`.
- [ ] **Step 5:** `npm run build:sim` (unsigned simulator build) passes; install and launch on the iPhone 17 Pro and iPad Pro simulators (`xcrun simctl`), screenshot the sign-in screen and, with `COMPASS_URL=http://localhost:5173` against local dev and dev login, Today. The system sheet can't complete against production in a simulator without Vlad; that's Task 7.
- [ ] **Step 6: Commit** `Phase 4 Task 2: iPhone and iPad app`.

---

### Task 3: Android app (Capacitor, Android)

**Files:** `mobile/android/…` via `npx cap add android`, `CompassNativePlugin.java`, `MainActivity.java`, `AndroidManifest.xml`, `build.gradle` changes

- [ ] **Step 1:** Add Android; `applicationId com.knocturnlabs.compass`, minSdk 24, targetSdk 36; Firebase applied only when `google-services.json` exists (Aura's pattern); `WEB_AUTHENTICATION_SUPPORT_FOR_APP` on (Aura's `MainActivity`).
- [ ] **Step 2: `CompassNativePlugin.java`:** `signIn` opens a Custom Tab on the URL (same host and scheme checks) and resolves when `MainActivity` receives `compass://auth?...` (intent-filter, singleTask); `registerPush` returns the FCM token (`kind: 'fcm'`) when Firebase is configured, else `unsupported`; notification taps open their `url` in the web view (allowlist); `ACTION_SEND` text/plain is delivered as `sharedText`.
- [ ] **Step 3: App Links:** intent-filter with `autoVerify` for `https://compass.knocturnlabs.com`.
- [ ] **Step 4: Icons** (adaptive, from the badge) and splash.
- [ ] **Step 5:** `./gradlew assembleDebug` passes; install on the API 36 emulator, screenshot sign-in and (against local dev) Today; share text from the emulator's browser into Compass and screenshot the prefilled quick add.
- [ ] **Step 6: Commit** `Phase 4 Task 3: Android app`.

---

### Task 4: Share extension (iOS) and Mac app (Tauri)

**Files:** `mobile/ios/App/ShareExtension/` (target added to the Xcode project), `mac/` (new Tauri 2 project)

- [ ] **Step 1: iOS Share Extension:** accepts text and URLs, writes them to the app group, shows "Added to Compass quick add — open Compass to finish" and closes; the app reads it on foreground (Task 2's `takeSharedText`). Build for the simulator and screenshot sharing from Safari.
- [ ] **Step 2: Mac app** (`mac/src-tauri`, Kelly-App's tray and global-shortcut code as the reference): identifier `com.knocturnlabs.compass`; a main window loading `https://compass.knocturnlabs.com` (remote URL with the Tauri capability that allows only that origin to call the app's commands); a menu-bar icon (the badge, monochrome template image) with Open Compass, Quick add (⌥⇧C global shortcut, ruling N7), Launch at login (autostart), Quit; the quick-add window is a small always-on-top window loading `/?quickadd=1`, which the web app renders as the palette alone; `tauri-plugin-deep-link` registers `compass://` and emits `compass-auth` to the main window; a 60-second outbox poll (only after sign-in, stops on 401) shows banners with `tauri-plugin-notification`, clicking one focuses the main window at its `url`; other hosts open in the default browser (`tauri-plugin-opener`).
- [ ] **Step 3:** `npm run tauri build -- --bundles app` builds `Compass.app` (signed with the Apple Development identity if available, else ad hoc); launch it, screenshot the menu-bar menu, the main window on the sign-in screen, and the quick-add window (against local dev with dev login for a signed-in shot).
- [ ] **Step 4: Commit** `Phase 4 Task 4: share extension and Mac app`.

---

### Task 5: Trust files and the Knocturn ID redirect (prepared, not deployed)

**Files:** Compass `web/public/.well-known/apple-app-site-association`, `web/public/.well-known/assetlinks.json`, `web/public/_headers` (JSON content type for the AASA); outside repos on branch `compass-phase-4`: `~/Documents/Knocturn-ID/wrangler.jsonc` (`APP_REDIRECTS` gains `compass=compass://auth`), `~/Documents/Knocturnlabs-Landing/public/.well-known/apple-app-site-association` (webcredentials gains `K948BT44PM.com.knocturnlabs.compass`) and `assetlinks.json` (gains `com.knocturnlabs.compass` with `get_login_creds` and the debug keystore SHA-256)

- [ ] **Step 1:** Compass files (N5) with a self-check that both parse as JSON and name the right ids; the Worker serves them with `application/json` (assets + `_headers`).
- [ ] **Step 2:** Outside repos: read each repo's CLAUDE.md, branch `compass-phase-4` from `HEAD`, change only those lines, run each repo's checks (Knocturn ID `npm run typecheck && node --test test/*.test.mjs`; Landing's checks if any), commit there. Never deploy.
- [ ] **Step 3: Commit** `Phase 4 Task 5: trust files and redirect (prepared)` in Compass.

---

### Task 6: Docs, smoke, deploy (Vlad's word), live push test

- [ ] **Step 1:** `CLAUDE.md` Phase 4 section (the shells, `mobile/` and `mac/` commands, the native sign-in rules, device push and the outbox, secrets Vlad puts, never bundling the app); `mobile/README.md` and `mac/README.md` with build and install steps.
- [ ] **Step 2:** Full local run: `npm run typecheck && npm run check && npm run build && npm run smoke`; `mobile` simulator and emulator builds; `mac` build.
- [ ] **Step 3: Stop and ask Vlad** (one message): approve the two outside deploys (Knocturn ID, knocturnlabs.com) and "deploy Compass" (migration 0006 + Worker); remind him of the push secrets (Who does what #3, #4).
- [ ] **Step 4: After his yes:** note versions, `npm run db:migrate:remote`, `npm run deploy`, deploy Knocturn ID and Landing from their branches, check `/.well-known/*` on both hosts (JSON, 200), `POST /api/auth/native` without a body → 400.
- [ ] **Step 5:** Write `docs/phase-4-verification.md` and commit.

### Task 7: On Vlad's devices (with him)

- [ ] **Step 1:** Vlad has signed Xcode in and connected the devices (Who does what #5, #6). Build and install on the iPhone and iPad from Xcode (automatic signing), the debug APK on the Samsung (`adb install`), and `Compass.app` on the Mac.
- [ ] **Step 2:** With Vlad: sign in through the sheet on each, turn notifications on, press "Send a test" (APNs on iPhone and iPad, FCM on Android, a banner within a minute on the Mac), share a link from Safari / Chrome into quick add, tap a `compass.knocturnlabs.com` link in Notes to open the app, press ⌥⇧C on the Mac.
- [ ] **Step 3:** Record results in `docs/phase-4-verification.md`, merge the outside branches into their main branches with `--ff-only` after the checks, commit.

## Spec coverage (self-review)

| Spec | Task |
| --- | --- |
| §11 Capacitor with `server.url` = the site (iPhone, iPad, Android) | 2, 3 |
| §11 push plugin; §9 shells register tokens | 0, 1, 2, 3 |
| §11 share sheet to quick add | 1, 2, 3, 4 (ruling N4) |
| §11 universal links for `compass.knocturnlabs.com` | 3, 5 (ruling N5) |
| §11 Mac: Tauri, menu-bar quick add, global hotkey, native notifications | 4 (rulings N3, N7) |
| §9 APNs reused from Kelly-Cloud with the same Apple key | 0, Who does what #3 |
| §2 Knocturn ID sign-in in every app | 0, 1, 2, 3, 4, 5 (ruling N1) |
| Catalogue §12 Android push (FCM) | 0, 3, Who does what #4 |

Not in Phase 4: widgets and Siri (v2), TestFlight / Play Store / a notarized Mac app (ruling N6, Who does what #7), Kelly's scopes (Phase 5).
