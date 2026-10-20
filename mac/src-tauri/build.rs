// The app's own commands get permissions (allow-open-external, ...), so only the capabilities in capabilities/ can reach them.
fn main() {
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
    tauri_build::AppManifest::new().commands(&["open_external", "notify_permission", "notify", "close_quick_add"]),
  ))
  .expect("tauri build");
}
