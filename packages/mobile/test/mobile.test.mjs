import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('mobile crate is Android-only and 100% Rust', () => {
  const cargo = read('Cargo.toml');
  assert.match(cargo, /^name = "veyvox-mobile"/m);
  assert.doesNotMatch(cargo, /apple-ios|aarch64-apple|xcode/i);
  assert.match(cargo, /crate-type\s*=\s*\[[^\]]*"cdylib"[^\]]*\]/);
  assert.ok(!cargo.includes('[package.metadata.xbuild]'));
  assert.ok(cargo.includes('[package.metadata.android]'));
  for (const file of ['src/main.rs', 'src/lib.rs', 'src/state.rs', 'src/api.rs', 'src/ws.rs', 'src/voice.rs', 'src/screens.rs']) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  const bridge = ['ios', 'wry', 'webview', 'tauri'];
  for (const banned of bridge) assert.doesNotMatch(cargo.toLowerCase(), new RegExp(`\\b${banned}\\b`));
});

test('mobile UI has entry points for the preview screens', () => {
  const lib = read('src/lib.rs');
  for (const screen of ['render_spaces_tab', 'render_dms_tab', 'render_you_tab', 'render_channel_chat', 'render_members', 'render_group_dm_info', 'render_voice_full', 'render_user_profile', 'render_settings_hub', 'render_mini_bar']) {
    assert.ok(lib.includes(screen), screen);
  }
  // Per-conversation drafts, failed rows with inline retry, attempt-guarded
  // voice fetches and single-field privacy patches are load-bearing
  // behaviors, not just screen names.
  for (const behavior of ['composer_by_channel', 'failed', 'Retry', 'VoiceFetch', 'voice_attempt', 'privacy_patch', 'detail_stale', 'dm_create', 'apply_ready_catalog']) {
    assert.ok(lib.includes(behavior), behavior);
  }
  const state = read('src/state.rs');
  for (const key of ['"channel-chat"', '"friends"', '"settings"', '"members"', '"voice-full"', '"user-profile"']) {
    assert.ok(state.includes(key), key);
  }
  const screens = read('src/screens.rs');
  assert.ok(screens.includes('dm_call_button'));
  assert.ok(screens.includes('bottom_nav'));
  assert.ok(screens.includes('screen_header'));
});

test('voice signaling includes call lifecycle rules', () => {
  const voice = read('src/voice.rs');
  for (const rule of ['can_start_dm_call', 'pending_dm_cancels', 'dm_waiting_until', 'refuse_dm_call', 'cancel_outgoing_dm_call', 'toggle_deafen', 'ring_incoming', 'accept_dm_call']) {
    assert.ok(voice.includes(rule), rule);
  }
  const ws = read('src/ws.rs');
  assert.ok(ws.includes('DmCallReject'));
  assert.ok(ws.includes('is_rejection_for'));
  assert.ok(ws.includes('dmChannelId'));
  assert.ok(ws.includes("client: 'mobile'"));
  assert.ok(ws.includes('set_read_timeout'));
  assert.ok(ws.includes('rustls') || read('Cargo.toml').includes('rustls-tls-webpki-roots'));
});

test('mobile version stays in lockstep', () => {
  const pkg = JSON.parse(read('package.json'));
  const cargo = read('Cargo.toml');
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(cargoVersion, pkg.version);
  const repoRoot = path.resolve(root, '..', '..');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, rootPkg.version);
});
