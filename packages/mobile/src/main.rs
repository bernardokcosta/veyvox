//! Binary entry for the Veyvox Android client.
//!
//! Android-only: on device the OS calls the `android_main` in the library
//! (NativeActivity via `winit`, exactly like the upstream `hello_android`
//! eframe example). This binary is the desktop preview
//! (`cargo run -p veyvox-mobile`) and is never packaged into the APK —
//! `cargo apk build --release --lib` packages the cdylib. There is no iOS
//! entry point.

use veyvox_mobile::VeyvoxApp;

#[cfg(not(target_os = "android"))]
fn main() -> Result<(), eframe::Error> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([390.0, 780.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Veyvox",
        options,
        Box::new(|cc| Ok(Box::new(VeyvoxApp::new(cc)) as Box<dyn eframe::App>)),
    )
}
