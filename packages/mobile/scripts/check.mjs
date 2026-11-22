import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cargo = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.rs'), 'utf8');
const lib = fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8');

const failures = [];
const ok = (cond, message) => { if (!cond) failures.push(message); };

ok(pkg.name === '@veyvox/mobile', 'package name must be @veyvox/mobile');
ok(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package version must be stable semver');
ok(pkg.scripts?.test === 'node --test "test/*.test.mjs"', 'test script must stay Node-based (no cargo needed for pnpm -r test)');

const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
ok(cargoVersion === pkg.version, `Cargo version ${cargoVersion} must match package.json ${pkg.version}`);

for (const dep of ['egui', 'eframe', 'winit', 'log', 'android_logger', 'serde', 'serde_json', 'ureq', 'url', 'uuid', 'chrono', 'tungstenite']) {
  ok(new RegExp(`^${dep}\\s*=`, 'm').test(cargo), `missing dependency ${dep}`);
}
for (const banned of ['tauri', 'wry', 'webview', 'deno']) {
  ok(!new RegExp(`\\b${banned}\\b`, 'i').test(cargo), `banned non-100%-Rust dependency: ${banned}`);
}
// Android-only: no iOS target, source, or workflow support.
ok(!/aarch64-apple-ios|ios-target|xcode/i.test(cargo), 'iOS target must not exist (Android-only)');
// cargo-apk (not xbuild) is the packager: cdylib + android metadata.
ok(/crate-type\s*=\s*\[[^\]]*"cdylib"[^\]]*\]/.test(cargo), 'lib must be a cdylib for cargo-apk');
ok(!/\[package\.metadata\.xbuild\]/.test(cargo), 'xbuild metadata must not exist (cargo-apk reads [package.metadata.android])');
ok(cargo.includes('[package.metadata.android]'), 'missing cargo-apk android metadata');
ok(cargo.includes('package = "io.github.bernardokcosta.veyvox"'), 'Android applicationId metadata missing');
ok(cargo.includes('resources = "android/res"'), 'packaged res/ overlay missing from android metadata');
ok(/min_sdk_version\s*=\s*28/.test(cargo), 'Android min_sdk_version metadata missing');
ok(cargo.includes('android.permission.INTERNET'), 'INTERNET permission missing from the manifest metadata');
ok(cargo.includes('aarch64-linux-android') && cargo.includes('x86_64-linux-android'), 'build_targets must cover phones (arm64) and the CI emulator (x86_64)');
// The OS entry point: NativeActivity android_main feeds the app to eframe,
// exactly like the upstream hello_android example. It lives in the cdylib
// (lib.rs), which is what `cargo apk build --lib` packages; main.rs is the
// host-only desktop preview. No iOS entry exists anywhere.
ok(!/fn android_main/.test(main), 'android_main must live in the cdylib, not the host binary');
ok(lib.includes('fn android_main'), 'missing Android android_main entry');
ok(lib.includes('android_app: Some(app)'), 'android_main must hand the AndroidApp to eframe');
ok(!/aarch64-apple-ios|target_os\s*=\s*"ios"|xcode|UIKit/i.test(main + lib), 'iOS entry must not exist (Android-only)');

// License rule (AGENTS.md): every direct dependency must be on the
// reviewed permissive list (MIT / Apache-2.0 / ISC / BSD). Adding a crate
// means adding it here with its license evidence in mobile-native.md.
const allowedDeps = new Set(['egui', 'eframe', 'winit', 'log', 'android_logger', 'serde', 'serde_json', 'ureq', 'url', 'uuid', 'chrono', 'tungstenite']);
const depLines = cargo.split(/^\[/m)
  .filter((section) => /^(?:dependencies|target\..+\.dependencies)\]\r?\n/.test(section))
  .flatMap((section) => section.split('\n').slice(1))
  .filter((line) => /^\s*[a-z0-9_-]+\s*=/i.test(line));
for (const line of depLines) {
  const name = line.split('=')[0].trim();
  ok(allowedDeps.has(name), `unreviewed dependency (add license evidence first): ${name}`);
}

const sources = ['src/main.rs', 'src/lib.rs', 'src/onboarding.rs', 'src/state.rs', 'src/api.rs', 'src/ws.rs', 'src/voice.rs', 'src/screens.rs'];
for (const file of sources) ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
ok(fs.existsSync(path.join(root, 'rust-toolchain.toml')), 'missing rust-toolchain.toml');
ok(fs.existsSync(path.join(root, 'android/res/drawable/ic_launcher.png')), 'missing packaged launcher icon');
const adaptiveIcon = path.join(root, 'android/res/drawable-v26/ic_launcher.xml');
ok(fs.existsSync(adaptiveIcon) && fs.readFileSync(adaptiveIcon, 'utf8').includes('@drawable/ic_launcher_foreground'),
  'missing adaptive launcher foreground reference');
ok(fs.existsSync(path.join(root, 'android/res/drawable/ic_launcher_foreground.png')), 'missing adaptive launcher foreground');
ok(cargo.includes('assets = "assets"') && fs.existsSync(path.join(root, 'assets/DMSans-OFL.txt')),
  'missing bundled DM Sans license');

if (failures.length) {
  console.error('mobile check failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`mobile check ok (${pkg.version})`);
