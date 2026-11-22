import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outDir = path.join(root, 'dist');
const cargoTarget = path.join(root, 'target');
// cargo-apk 0.10.0's signed --lib output. The sibling *-unaligned.apk
// is an unsigned staging file, not a candidate for distribution.
const built = path.join(cargoTarget, 'release', 'apk', 'veyvox_mobile.apk');
const apkName = `Veyvox-${pkg.version}-android.apk`;
const APP_ID = 'io.github.bernardokcosta.veyvox';

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
  return result.status === 0;
}

function capture(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(result.stderr || '').slice(0, 2000)}`);
  }
  return result.stdout;
}

function latestBuildTool(binary) {
  const home = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  if (!home) throw new Error('ANDROID_HOME is not set (Android SDK requirement)');
  const tools = path.join(home, 'build-tools');
  const versions = fs.readdirSync(tools).filter((v) => fs.existsSync(path.join(tools, v, binary)));
  if (!versions.length) throw new Error(`no Android build-tools ${binary} found under ${tools}`);
  versions.sort();
  return path.join(tools, versions[versions.length - 1], binary);
}

console.log(`Building ${apkName} (Android-only, 100% Rust via cargo-apk)…`);

// Host checks first: fast, no SDK needed, catches API drift before the APK step.
if (!run('cargo', ['test', '--locked'])) {
  console.error('cargo test failed; refusing to package an APK from red sources.');
  process.exit(1);
}
try {
  capture('cargo', ['apk', 'version']);
} catch {
  console.error('cargo-apk is not installed. Run: cargo install cargo-apk --version 0.10.0 --locked');
  process.exit(1);
}

// Signing: tag builds use the dedicated release keystore from secrets and
// fail closed without it, so every published APK shares one certificate.
// PR/push builds use an ephemeral CI keystore (install-check only).
const isTag = process.env.GITHUB_REF_TYPE === 'tag';
if (isTag) {
  const encoded = process.env.ANDROID_RELEASE_KEYSTORE_BASE64;
  const password = process.env.ANDROID_RELEASE_KEYSTORE_PASSWORD;
  if (!encoded || !password) {
    console.error(
      'Tag build without ANDROID_RELEASE_KEYSTORE_BASE64 / ANDROID_RELEASE_KEYSTORE_PASSWORD. ' +
      'Add the dedicated release keystore as repository secrets; refusing to ship a differently-signed APK.',
    );
    process.exit(1);
  }
  const keystore = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veyvox-release-')), 'release.keystore');
  fs.writeFileSync(keystore, Buffer.from(encoded, 'base64'));
  process.env.CARGO_APK_RELEASE_KEYSTORE = keystore;
  process.env.CARGO_APK_RELEASE_KEYSTORE_PASSWORD = password;
  console.log('Release signing with the dedicated keystore.');
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvox-dev-'));
  const keystore = path.join(dir, 'dev.keystore');
  if (
    !run('keytool', [
      '-genkeypair', '-keystore', keystore, '-alias', 'veyvox-dev',
      '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30',
      '-storepass', 'veyvox-dev', '-keypass', 'veyvox-dev',
      '-dname', 'CN=Veyvox CI',
    ])
  ) {
    console.error('keytool failed; a JDK is required to mint the ephemeral CI keystore.');
    process.exit(1);
  }
  process.env.CARGO_APK_RELEASE_KEYSTORE = keystore;
  process.env.CARGO_APK_RELEASE_KEYSTORE_PASSWORD = 'veyvox-dev';
  console.log('Ephemeral CI keystore (install-check only, never published).');
}

if (!run('cargo', ['apk', 'build', '--release', '--lib', '-p', 'veyvox-mobile', '--target-dir', cargoTarget])) {
  console.error('cargo apk build failed. Install Rust + Android SDK 34 + NDK r27, then retry.');
  process.exit(1);
}

if (!fs.statSync(built, { throwIfNoEntry: false })?.size) {
  console.error(`No nonempty signed APK at ${built}.`);
  process.exit(1);
}

// Verify identity with the platform tools, not just the file name:
// package, version, SDK floor, INTERNET permission, launchable activity
// and one native library per ABI the manifest promises.
const aapt = latestBuildTool(process.platform === 'win32' ? 'aapt.exe' : 'aapt');
const badging = capture(aapt, ['dump', 'badging', built]);
const mustMatch = (pattern, what) => {
  if (!pattern.test(badging)) {
    console.error(`APK verification failed: ${what}.\n${badging.slice(0, 3000)}`);
    process.exit(1);
  }
};
mustMatch(new RegExp(`package: name='${APP_ID}'`), 'applicationId');
mustMatch(new RegExp(`versionName='${pkg.version.replace(/\./g, '\\.')}'`), 'versionName');
mustMatch(/sdkVersion:'28'/, 'minSdkVersion 28');
mustMatch(/targetSdkVersion:'34'/, 'targetSdkVersion 34');
mustMatch(/uses-permission: name='android.permission.INTERNET'/, 'INTERNET permission');
mustMatch(/launchable-activity: name='/, 'launchable MAIN/LAUNCHER activity');
const zipEntries = new Set(capture(aapt, ['list', built]).split(/\r?\n/));
for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86_64']) {
  if (!zipEntries.has(`lib/${abi}/libveyvox_mobile.so`)) {
    console.error(`APK verification failed: no Veyvox native library for ${abi}.`);
    process.exit(1);
  }
}
// Invoke the same SDK signer JAR on every host without a Windows batch shell.
const apksigner = path.join(path.dirname(aapt), 'lib', 'apksigner.jar');
console.log(capture('java', ['-jar', apksigner, 'verify', '--print-certs', built]).split('\n').slice(0, 4).join('\n'));
fs.mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, apkName);
fs.copyFileSync(built, target);
// Sidecar digest: the release job compares the published asset against
// exactly these bytes instead of trusting the file name.
const sha256 = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
fs.writeFileSync(`${target}.sha256`, `${sha256}  ${apkName}\n`);
console.log(`sha256: ${sha256}`);
console.log(`Built ${apkName} (${fs.statSync(target).size} bytes) from ${built}`);
