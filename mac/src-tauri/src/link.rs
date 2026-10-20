//! Where the Mac app's web views may go, and what may leave them. The same rules as mobile/ios/App/App/CompassLink.swift:
//! the web view stays on the Compass host, other web pages open in the default browser, mailto/tel in their apps, other
//! schemes go nowhere; sign-in comes back only as compass://auth; banner clicks and downloads only from Compass.
use std::path::{Path, PathBuf};
use tauri::Url;

pub const HOME: &str = "https://compass.knocturnlabs.com";

/// The server the windows show: Compass, or `COMPASS_URL` given at build time (local tests, e.g. http://localhost:5173).
pub fn server() -> Url {
  Url::parse(option_env!("COMPASS_URL").unwrap_or(HOME)).expect("COMPASS_URL is not a URL")
}

#[derive(Debug, PartialEq, Eq)]
pub enum Route {
  InApp,
  External,
  Drop,
}

/// Same scheme, host and port as `server`, and no user@ part.
pub fn on_server(url: &Url, server: &Url) -> bool {
  url.scheme() == server.scheme()
    && url.host_str() == server.host_str()
    && url.port_or_known_default() == server.port_or_known_default()
    && url.username().is_empty()
    && url.password().is_none()
}

/// A top-level navigation or a `window.open`.
pub fn route(url: &Url, server: &Url) -> Route {
  match url.scheme() {
    "http" | "https" if on_server(url, server) => Route::InApp,
    "http" | "https" | "mailto" | "tel" => Route::External,
    _ => Route::Drop,
  }
}

/// What `open_external` may open: a web page (no user@ part), mailto: or tel:.
pub fn external(raw: &str) -> Option<Url> {
  let url = Url::parse(raw).ok()?;
  match url.scheme() {
    "http" | "https" if url.username().is_empty() && url.password().is_none() && url.host_str().is_some() => Some(url),
    "mailto" | "tel" => Some(url),
    _ => None,
  }
}

/// Knocturn ID's answer: exactly compass://auth (no user, port or path) with its query.
pub fn is_auth_callback(url: &Url) -> bool {
  url.scheme() == "compass"
    && url.host_str() == Some("auth")
    && url.username().is_empty()
    && url.password().is_none()
    && url.port().is_none()
    && (url.path().is_empty() || url.path() == "/")
}

/// A banner's url (a path such as /meetings/1, or a full Compass URL), resolved with its ?search#hash. Compass only.
pub fn open_target(raw: &str, server: &Url) -> Option<Url> {
  if raw.is_empty() || raw.starts_with("//") {
    return None;
  }
  let url = server.join(raw).ok()?;
  let home = Url::parse(HOME).ok()?;
  (on_server(&url, server) || on_server(&url, &home)).then_some(url)
}

/// A download the page started: a Compass URL (an attachment) or a blob: the Compass page made (a report, an export).
pub fn download_allowed(url: &Url, server: &Url) -> bool {
  match url.scheme() {
    "http" | "https" => on_server(url, server),
    "blob" => Url::parse(url.path()).is_ok_and(|inner| on_server(&inner, server)),
    _ => false,
  }
}

/// A file name that is safe in ~/Downloads: no path or reserved characters, no leading dot, 150 characters at most.
pub fn safe_name(name: &str) -> String {
  let clean: String = name
    .chars()
    .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '-' } else { c })
    .collect();
  let clean: String = clean.trim().trim_start_matches(['.', ' ']).chars().take(150).collect();
  if clean.trim().is_empty() { "download".into() } else { clean }
}

/// `dir/name`, or `dir/stem (n).ext` when that file exists already: nothing is overwritten.
pub fn unique(dir: &Path, name: &str) -> PathBuf {
  let first = dir.join(name);
  if !first.exists() {
    return first;
  }
  let p = Path::new(name);
  let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
  let ext = p.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
  (1..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|c| !c.exists()).unwrap()
}

#[cfg(test)]
mod tests {
  use super::*;
  fn u(s: &str) -> Url {
    Url::parse(s).unwrap()
  }

  #[test]
  fn the_web_view_stays_on_compass() {
    let prod = u(HOME);
    let dev = u("http://localhost:5173");
    assert_eq!(route(&u("https://compass.knocturnlabs.com/projects/1?x=1#y"), &prod), Route::InApp);
    assert_eq!(route(&u("https://COMPASS.knocturnlabs.com/"), &prod), Route::InApp);
    assert_eq!(route(&u("https://compass.knocturnlabs.com:443/"), &prod), Route::InApp);
    assert_eq!(route(&u("http://localhost:5173/today"), &dev), Route::InApp);
    for out in [
      "https://example.com/",
      "http://compass.knocturnlabs.com/",
      "https://compass.knocturnlabs.com:8443/",
      "https://compass.knocturnlabs.com.evil.com/",
      "https://compass.knocturnlabs.com@evil.com/",
      "https://me@compass.knocturnlabs.com/",
      "https://id.knocturnlabs.com/",
      "mailto:a@b.c",
      "tel:+15555550100",
    ] {
      assert_eq!(route(&u(out), &prod), Route::External, "{out}");
    }
    assert_eq!(route(&u("http://localhost:5174/"), &dev), Route::External);
    for bad in ["javascript:alert(1)", "data:text/html,hi", "file:///etc/hosts", "sms:1", "compass://auth?code=1", "about:blank", "blob:https://compass.knocturnlabs.com/1"] {
      assert_eq!(route(&u(bad), &prod), Route::Drop, "{bad}");
    }
  }

  #[test]
  fn only_pages_mail_and_phone_open_outside() {
    assert!(external("https://id.knocturnlabs.com/?app=compass").is_some());
    assert!(external("http://example.com/a").is_some() && external("mailto:a@b.c").is_some() && external("tel:1").is_some());
    for bad in ["", "not a url", "javascript:alert(1)", "file:///Applications/Calculator.app", "compass://auth", "sms:1", "https://x@evil.com/", "-a Terminal", "vnc://host"] {
      assert!(external(bad).is_none(), "{bad}");
    }
  }

  #[test]
  fn sign_in_comes_back_only_as_compass_auth() {
    assert!(is_auth_callback(&u("compass://auth?code=1&state=2")));
    assert!(is_auth_callback(&u("compass://auth/?error=access_denied&state=2")));
    for bad in ["compass://other?code=1", "compass://auth/x?code=1", "compass://auth.evil?code=1", "compass://me@auth?code=1", "compass://auth:1?code=1", "health://auth?code=1", "https://auth/?code=1"] {
      assert!(!is_auth_callback(&u(bad)), "{bad}");
    }
  }

  #[test]
  fn banners_open_compass_only() {
    let prod = u(HOME);
    let dev = u("http://localhost:5173");
    assert_eq!(open_target("/meetings/1?a=b#c", &prod).unwrap().as_str(), "https://compass.knocturnlabs.com/meetings/1?a=b#c");
    assert_eq!(open_target("/", &prod).unwrap().as_str(), "https://compass.knocturnlabs.com/");
    assert_eq!(open_target("/projects/2", &dev).unwrap().as_str(), "http://localhost:5173/projects/2");
    assert_eq!(open_target("https://compass.knocturnlabs.com/x", &dev).unwrap().as_str(), "https://compass.knocturnlabs.com/x");
    for bad in ["", "https://evil.com/", "//evil.com/x", "javascript:alert(1)", "http://compass.knocturnlabs.com/", "https://me@compass.knocturnlabs.com/", "https://compass.knocturnlabs.com.evil.com/", "compass://auth", "https://compass.knocturnlabs.com:8443/"] {
      assert!(open_target(bad, &prod).is_none(), "{bad}");
    }
  }

  #[test]
  fn downloads_only_from_compass() {
    let prod = u(HOME);
    assert!(download_allowed(&u("blob:https://compass.knocturnlabs.com/6f1c"), &prod));
    assert!(download_allowed(&u("https://compass.knocturnlabs.com/api/documents/1/file"), &prod));
    for bad in ["blob:https://evil.com/1", "https://evil.com/f.pdf", "blob:null/1", "data:text/plain,hi", "file:///etc/hosts", "https://compass.knocturnlabs.com.evil.com/f"] {
      assert!(!download_allowed(&u(bad), &prod), "{bad}");
    }
  }

  #[test]
  fn download_names_are_safe_and_never_overwrite() {
    assert_eq!(safe_name("Status report 2026-10-20.docx"), "Status report 2026-10-20.docx");
    assert_eq!(safe_name("../../etc/passwd"), "-..-etc-passwd");
    assert_eq!(safe_name(".zshrc"), "zshrc");
    assert_eq!(safe_name("a:b\u{0}c"), "a-b-c");
    assert_eq!(safe_name("  "), "download");
    assert_eq!(safe_name(&"x".repeat(300)).len(), 150);
    let dir = std::env::temp_dir().join(format!("compass-dl-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(unique(&dir, "r.docx"), dir.join("r.docx"));
    std::fs::write(dir.join("r.docx"), b"").unwrap();
    std::fs::write(dir.join("r (1).docx"), b"").unwrap();
    assert_eq!(unique(&dir, "r.docx"), dir.join("r (2).docx"));
    std::fs::remove_dir_all(&dir).unwrap();
  }
}
