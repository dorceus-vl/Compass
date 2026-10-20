//! Banners through UNUserNotificationCenter (ruling P4-6). The page reads the outbox and calls `notify`. Each banner carries its
//! url in `userInfo`, so nothing is kept here. A click focuses the main window at that url (Compass only, with ?search#hash), and
//! banners also show while Compass is in front. Needs the signed .app (a bundle id); `cargo test` never calls it.
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{NSDictionary, NSError, NSString};
use objc2_user_notifications::{
  UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions, UNNotificationRequest,
  UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Url};

const URL_KEY: &str = "url";

define_class!(
  // SAFETY: NSObject has no subclassing requirements; no Drop.
  #[unsafe(super(NSObject))]
  #[name = "CompassNotificationDelegate"]
  #[ivars = AppHandle]
  struct Delegate;

  unsafe impl NSObjectProtocol for Delegate {}

  unsafe impl UNUserNotificationCenterDelegate for Delegate {
    #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
    fn will_present(
      &self,
      _center: &UNUserNotificationCenter,
      _notification: &UNNotification,
      handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
    ) {
      handler.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List | UNNotificationPresentationOptions::Sound,));
    }

    #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
    fn did_receive(&self, _center: &UNUserNotificationCenter, response: &UNNotificationResponse, handler: &block2::DynBlock<dyn Fn()>) {
      let info = response.notification().request().content().userInfo();
      let raw = info
        .objectForKey(&NSString::from_str(URL_KEY))
        .and_then(|o| o.downcast::<NSString>().ok())
        .map(|s| s.to_string())
        .unwrap_or_default();
      let target = crate::link::open_target(&raw, &crate::link::server()).unwrap_or_else(crate::link::server);
      crate::open_in_main(self.ivars(), target);
      handler.call(());
    }
  }
);

fn center() -> Retained<UNUserNotificationCenter> {
  UNUserNotificationCenter::currentNotificationCenter()
}

/// Sets the delegate once at start. The center holds it weakly, so it lives for the whole run.
pub fn install(app: &AppHandle) {
  let delegate: Retained<Delegate> = unsafe { msg_send![super(Delegate::alloc().set_ivars(app.clone())), init] };
  center().setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
  std::mem::forget(delegate);
}

/// Asks macOS for banners and sounds (a prompt the first time only) and answers what the person decided.
pub async fn permission() -> bool {
  let (tx, rx) = std::sync::mpsc::channel();
  {
    let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
      let _ = tx.send(granted.as_bool());
    });
    center().requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound, &block);
  } // the Objective-C objects stay on this side of the await
  let granted = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(false)).await.unwrap_or(false);
  eprintln!("compass: notification authorization granted={granted}");
  granted
}

/// One banner; `url` rides along in userInfo for the click.
pub fn show(id: &str, title: &str, body: &str, url: &Url) {
  let content = UNMutableNotificationContent::new();
  content.setTitle(&NSString::from_str(title));
  content.setBody(&NSString::from_str(body));
  content.setSound(Some(&UNNotificationSound::defaultSound()));
  let info = NSDictionary::from_slices(&[&*NSString::from_str(URL_KEY)], &[&*NSString::from_str(url.as_str())]);
  // SAFETY: userInfo is a plist dictionary; NSString keys and values are valid, the generics are only for Rust.
  unsafe { content.setUserInfo(&*(Retained::as_ptr(&info) as *const NSDictionary)) };
  let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(id), &content, None);
  let done = RcBlock::new(|err: *mut NSError| match unsafe { err.as_ref() } {
    None => eprintln!("compass: banner added"),
    Some(e) => eprintln!("compass: banner refused: {}", e.localizedDescription()),
  });
  center().addNotificationRequest_withCompletionHandler(&request, Some(&done));
}
