// Compass for Mac (Phase 4): a menu-bar app around compass.knocturnlabs.com. The main window is the live site; the menu-bar
// icon has Open Compass, Quick add (⌥⇧C anywhere, ruling N7), Launch at login and Quit; closing the window keeps the app
// running (no Dock icon while it is hidden). Sign-in goes through the default browser and comes back as compass://auth; banners
// come from the server's outbox, which the page reads every minute (ruling N3) and hands to `notify`. web/src/native.ts is the
// caller; src/link.rs holds the rules for where things may go.
mod link;

use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;

use link::{server, Route};
use serde_json::json;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-template.png");
/// Launch at login starts the app with this, so it waits in the menu bar instead of opening its window.
const HIDDEN: &str = "--hidden";

/// The url of each banner shown, by notification id, for when it is clicked.
#[derive(Default)]
struct Banners(Mutex<HashMap<i32, Url>>, AtomicI32);

fn open_outside(app: &AppHandle, url: &Url) {
  let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

/// Locks a window to the Compass host: other web pages open in the default browser, mailto/tel in their apps, the rest nowhere.
fn locked<'a>(app: &'a AppHandle, label: &str, title: &str, url: Url) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
  let srv = server();
  let (nav_app, new_app, dl_srv) = (app.clone(), app.clone(), srv.clone());
  WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
    .title(title)
    .background_color(tauri::window::Color(5, 5, 7, 255)) // #050507, the app's ground, so no white flash
    .on_navigation(move |url| match link::route(url, &srv) {
      Route::InApp => true,
      Route::External => {
        open_outside(&nav_app, url);
        false
      }
      Route::Drop => false,
    })
    .on_new_window(move |url, _| {
      match link::route(&url, &server()) {
        Route::InApp => {
          if let Some(main) = new_app.get_webview_window("main") {
            let _ = main.navigate(url);
            show_main(&new_app);
          }
        }
        Route::External => open_outside(&new_app, &url),
        Route::Drop => {}
      }
      NewWindowResponse::Deny
    })
    .on_download(move |webview, event| match event {
      // Reports and exports (a blob: the page made) and attachments: into ~/Downloads under a safe name, then shown in Finder.
      DownloadEvent::Requested { url, destination } => {
        let Ok(dir) = webview.app_handle().path().download_dir() else { return false };
        if !link::download_allowed(&url, &dl_srv) {
          return false;
        }
        let name = link::safe_name(destination.file_name().and_then(|n| n.to_str()).unwrap_or(""));
        *destination = link::unique(&dir, &name);
        true
      }
      DownloadEvent::Finished { path: Some(path), success: true, .. } => {
        let _ = webview.app_handle().opener().reveal_item_in_dir(path);
        true
      }
      _ => true,
    })
}

fn show_main(app: &AppHandle) {
  #[cfg(target_os = "macos")]
  let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
  if let Some(win) = app.get_webview_window("main") {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
  }
}

fn quick_add(app: &AppHandle) {
  if let Some(win) = app.get_webview_window("quickadd") {
    let _ = win.show();
    let _ = win.set_focus();
    return;
  }
  let Ok(url) = server().join("/?quickadd=1") else { return };
  let _ = locked(app, "quickadd", "Quick add", url)
    .inner_size(640.0, 420.0)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .always_on_top(true)
    .center()
    .focused(true)
    .build();
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
  let url = link::external(&url).ok_or("Not a page, mail or phone link")?;
  app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())
}

/// The Mac shows banners itself (from the outbox); nothing to ask or register.
#[tauri::command]
fn notify_permission() -> &'static str {
  "granted"
}

/// One banner from the outbox. Clicking it opens its url in the main window (Compass only; anything else opens Compass's home).
#[tauri::command]
fn notify(app: AppHandle, banners: tauri::State<'_, Banners>, title: String, body: String, url: String) -> Result<(), String> {
  let target = link::open_target(&url, &server()).unwrap_or_else(server);
  let id = banners.1.fetch_add(1, Ordering::Relaxed) + 1;
  banners.0.lock().unwrap().insert(id, target);
  let clip = |s: &str, n: usize| s.chars().take(n).collect::<String>();
  app.notification().builder().id(id).title(clip(&title, 120)).body(clip(&body, 500)).show().map_err(|e| e.to_string())
}

/// The quick-add page closes its own window after a save or Escape; no other window can be closed this way.
#[tauri::command]
fn close_quick_add(window: WebviewWindow) {
  if window.label() == "quickadd" {
    let _ = window.close();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let quick = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyC);
  let app = tauri::Builder::default()
    .manage(Banners::default())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN])))
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
          if shortcut == &quick && event.state() == ShortcutState::Pressed {
            quick_add(app);
          }
        })
        .build(),
    )
    .invoke_handler(tauri::generate_handler![open_external, notify_permission, notify, close_quick_add])
    .setup(move |app| {
      let handle = app.handle().clone();
      let srv = server();
      // A local build (COMPASS_URL) lets that origin call the same commands as compass.knocturnlabs.com.
      if option_env!("COMPASS_URL").is_some() {
        let origin = format!("{}/*", srv.origin().ascii_serialization());
        app.add_capability(
          tauri::ipc::CapabilityBuilder::new("compass-main-local").remote(origin.clone()).local(false).window("main")
            .permission("core:event:allow-listen").permission("core:event:allow-unlisten")
            .permission("allow-open-external").permission("allow-notify-permission").permission("allow-notify"),
        )?;
        app.add_capability(
          tauri::ipc::CapabilityBuilder::new("compass-quickadd-local").remote(origin).local(false).window("quickadd")
            .permission("allow-close-quick-add"),
        )?;
      }

      let hidden = std::env::args().any(|a| a == HIDDEN);
      #[cfg(target_os = "macos")]
      app.set_activation_policy(if hidden { tauri::ActivationPolicy::Accessory } else { tauri::ActivationPolicy::Regular });
      let main = locked(&handle, "main", "Compass", srv).inner_size(1280.0, 840.0).min_inner_size(380.0, 560.0).visible(!hidden).build()?;
      let h = handle.clone();
      main.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
          // Closing hides: the app keeps running in the menu bar (banners, quick add), without a Dock icon.
          api.prevent_close();
          if let Some(w) = h.get_webview_window("main") {
            let _ = w.hide();
          }
          #[cfg(target_os = "macos")]
          let _ = h.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
      });

      // Knocturn ID's answer: exactly compass://auth goes to the page waiting for it (native.ts tauriSignIn); anything else is ignored.
      let h = handle.clone();
      app.deep_link().on_open_url(move |event| {
        for url in event.urls().into_iter().filter(link::is_auth_callback) {
          let _ = h.emit_to("main", "compass-auth", json!({ "url": url.as_str() }));
          show_main(&h);
        }
      });

      // A click on a banner: its url in the main window.
      let h = handle.clone();
      app.notification().on_action(move |performed| {
        let Some(id) = performed.notification().map(|n| n.id()) else { return };
        let Some(url) = h.state::<Banners>().0.lock().unwrap().remove(&id) else { return };
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || {
          if let Some(main) = h2.get_webview_window("main") {
            let _ = main.navigate(url);
          }
          show_main(&h2);
        });
      })?;

      let open = MenuItem::with_id(app, "open", "Open Compass", true, None::<&str>)?;
      let add = MenuItem::with_id(app, "quickadd", "Quick add", true, Some("Alt+Shift+C"))?;
      let login = CheckMenuItem::with_id(app, "login", "Launch at login", true, app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit Compass", true, None::<&str>)?;
      let sep = PredefinedMenuItem::separator(app)?;
      let login_item = login.clone();
      TrayIconBuilder::with_id("compass")
        .icon(tauri::image::Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(true)
        .tooltip("Compass (⌥⇧C quick add)")
        .menu(&Menu::with_items(app, &[&open, &add, &sep, &login, &quit])?)
        .on_menu_event(move |app, event| match event.id.as_ref() {
          "open" => show_main(app),
          "quickadd" => quick_add(app),
          "login" => {
            let al = app.autolaunch();
            let on = al.is_enabled().unwrap_or(false);
            let _ = if on { al.disable() } else { al.enable() };
            let _ = login_item.set_checked(al.is_enabled().unwrap_or(!on));
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .build(app)?;

      // Another app holding ⌥⇧C must not stop Compass from starting: the menu still has Quick add.
      if let Err(err) = app.global_shortcut().register(quick) {
        eprintln!("⌥⇧C is taken by another app: {err}");
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building Compass");

  app.run(|app, event| match event {
    // Closing the last window never quits; only Quit (or ⌘Q) does.
    RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
    #[cfg(target_os = "macos")]
    RunEvent::Reopen { .. } => show_main(app),
    _ => {}
  });
}
