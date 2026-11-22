# Mobile Native (Android, 100% Rust)

Source files:
- `packages/mobile/Cargo.toml` — `veyvox-mobile` crate, permissive deps only (MIT/Apache-2.0/ISC/BSD), cargo-apk Android metadata
- `packages/mobile/rust-toolchain.toml` — stable + `aarch64` / `armv7` / `x86_64` Android targets
- `packages/mobile/android/res/drawable-v26/ic_launcher.xml` — adaptive launcher icon, with a separate transparent mark and plum background; alpha-clean PNG fallback
- `packages/mobile/src/main.rs` — host preview `main`
- `packages/mobile/src/lib.rs` — `android_main` (NativeActivity → eframe) and `VeyvoxApp`: login bootstrap, lazy history, reconciled sends, WS dispatch, voice gating
- `packages/mobile/src/onboarding.rs` — native server selection and login presentation
- `packages/mobile/src/state.rs` — tabs, screen stack, spaces/channels/DMs/friends/members/messages
- `packages/mobile/src/api.rs` — REST client, same routes and envelopes as the web client
- `packages/mobile/src/ws.rs` — realtime socket worker (`client: 'mobile'`), `type`-tagged frames
- `packages/mobile/src/voice.rs` — voice state machine, same gates as `voiceStore`
- `packages/mobile/src/screens.rs` — bottom nav, headers, DM-call button, badge rules
- `packages/web/src/platform/mobileDownload.ts` — canonical APK filename + release URL helper
- `.github/workflows/mobile-android.yml` — reusable APK builder + emulator install-and-open gate
- `scripts/mobile-android.test.mjs` — release wiring, Docker sync, version lockstep
- `scripts/bump-version.mjs` (`updateRustVersion`) — keeps `Cargo.toml` + `Cargo.lock` in the release bump

Cross-references:
- Responsive web shell this mirrors: `docs/systems/mobile-ui.md`
- Voice state machine, LiveKit token flow: `docs/systems/voice.md`
- REST/WS wire contracts: `docs/systems/api.md`, `docs/systems/websocket.md`
- Release inventory (desktop set this extends without touching): `docs/systems/deployment.md`, `docs/systems/desktop.md`

## Scope

Android-only. There is no iOS target, no iOS source, no iOS workflow, and
none is planned. The crate, the workflows and every test assert this:
`aarch64-apple-ios` / `xcode` / UIKit must not appear, and the only
packaged artifact is the universal `Veyvox-<version>-android.apk`
(arm64 phones, 32-bit ARM, and the x86_64 slice the CI emulator boots).

100% Rust means the app crate: `egui` + `eframe` rendering,
`winit`/`android-activity` entry, `ureq` blocking REST on worker
threads, `tungstenite` WebSocket, `serde` models. No webview, no JS
bridge, no committed Kotlin/Java. The APK bootstrap (manifest, signing
block, resource packaging) is produced at build time by `cargo-apk`
(MIT/Apache-2.0, `cargo install cargo-apk --version 0.10.0 --locked`),
not committed here.

## Preview interface mapping

The preview maps the following `MobileShell` surfaces. It does not have
full visual or functional parity with the web client.

Before sign-in, the native UI follows the desktop instance picker and
web `LoginPage`: the user confirms the server address, then enters the
account credentials for that address. Both steps share the dark auth
palette, DM Sans type and full-width touch controls. A scrollable card
keeps the flow usable in shorter windows. The auth copy follows the
device's English/Portuguese language (English fallback). Changing the
selected server or signing out clears credential drafts and their edit
history; selecting an address does not send a network request or submit
the login form.

| Web (`packages/web/.../layout/`) | Rust (`packages/mobile/src/`) | Notes |
|----------------------------------|-------------------------------|-------|
| `MobileShell` tabs + `MobileBottomNav` | `screens::bottom_nav`, `AppState::{tab,stack}` | 56 px bar, hides on pushed screens; DMs badge caps at `99+` |
| `MobileScreenStack` + `MobileScreenHeader` | `screens::screen_header`, `should_show_bottom_nav` | back chevron pops one entry |
| `MobileSpacesScreen` | `VeyvoxApp::render_spaces_tab` | space strip from `GET /spaces`, channels/members from `GET /spaces/:id` (lazy per space) |
| `MobileDmsScreen` | `render_dms_tab` | newest-first (`sorted_dms`), last-message preview, per-DM call button, incoming-ring banner |
| `MobileChatScreen` | `render_channel_chat` | server history (`GET …/messages?limit=50`, lazy per channel), pending `…` echo, WS live inserts |
| `MobileYouScreen` | `render_you_tab` | real account name, admin flag, Edit profile / Friends / Voice & video / Settings + logout |
| `MobileSettingsScreen` | `render_settings_hub` + account/appearance/voice/privacy/instance panels | account shows the signed-in `AuthResponse.user`; appearance switches egui visuals; privacy PATCHes `discoverable`/`showActivity`; instance shows real name/version + change-instance |
| `FriendsPage` (mobile `friends` screen) | `render_friends` | real `GET /social/friends` list, exact-username `POST /social/requests`, tap opens profile |
| `MobileMembersScreen` | `render_members` | online-first roster from the space detail cache, tap opens `user-profile` |
| `MobileGroupDmInfo` (via `group-dm-info`) | `render_group_dm_info` | real members, owner rename (`PATCH /dm/:id`), leave (`DELETE /dm/:id/members` + local drop) |
| `MobileVoiceMiniBar` | `render_mini_bar` | shown when a call is live and `voice-full` is not on top; mute broadcasts `voice_status` |
| `MobileVoiceFullScreen` | `render_voice_full` | participant list from `voice_state_update` / `space_voice_state`, mute/deafen/camera + `voice_status`, leave tears down the right call |
| `MobileChatScreen` DM-call chip | `screens::dm_call_button` | In call → Ringing → Idle → Busy, first match wins (same as web) |
| `IncomingCallModal` accept/decline | `accept_incoming_call` / `decline_incoming_call` | `dm_call_accept` gates then activates; `dm_call_reject` is scoped to the ringing DM before the send |

Unread rules match the web: `unreadCounts` from `ready` mark spaces, and
per-DM `readStates` vs `lastMessage` mark DMs. `setMobileTab` clears the
stack in both clients.

## Data flow (all network off the egui frame)

```
login → one bootstrap worker:
  POST /auth/login → { token, user }          (AuthResponse shape)
  GET /spaces, GET /spaces/:first (channels+members),
  GET /dm, GET /social/friends, GET /instance/info, GET /users/@me
channel/space open → lazy worker (history page / space detail, cached)
send → optimistic row (pending) + per-send receiver:
  success → server row replaces the echo (id reconcile)
  failure → echo removed, body restored to the composer, toast
voice tap → ws frame first (voice_join / dm_call_start) → token worker
  { channelId | dmChannelId } → attempt-guarded apply:
  stale or post-cancel answers are dropped, errors clean the half-call
WS worker (client: 'mobile') → one upgrade to the selected instance
  (no redirects; a shared five-second connection/handshake deadline).
  Logout closes the underlying TCP stream even during a pending upgrade.
  ready replaces the catalog and invalidates cached history while keeping
  pending/failed sends; viewing a chat fetches its latest 50 messages again.
  The displayed history merges by message ID and is ordered chronologically.
  Live DMs update their last-message order and unread state; the app sends
  channel_ack only via the explicit Mark as read action by the latest
  message. Rendering a chat does not undo a mark-unread from another device.
  Messages adopt pending echoes else upsert; call events drive the ring state;
  voice_state_update keeps the participant list live; correlated error
  frames drop exactly the call they name.
```

## Voice

Same slots and gates as the web (`voice.md`, `utils/voiceActions.ts`):

- one space voice channel at a time, one active DM call at a time;
- `can_start_dm_call` is the outgoing-call gate (no active/outgoing/incoming
  call, no pending cancel, no re-ring suppression);
- the WS frame goes out before any local state flips, so a dead socket
  can never arm a call;
- cancel queues `pending_dm_cancels` + `dm_waiting_until` (ping/pong guard);
- deafen forces mute;
- every token fetch carries a generation counter: a late answer can
  neither open `voice-full` nor wedge the UI, and a failed fetch always
  tears down the half-call it belonged to;
- mute/deafen/camera broadcast `voice_status`, the same frame the web
  `broadcastVoiceStatus` path sends.

Token fetch is `POST /livekit/token` with `{ channelId }` or
`{ dmChannelId }` → `{ token, url }`, held in `VoiceSession` until the
call ends. The app does not join a LiveKit media room: it exposes
signaling for testing, but audio, video, and screen sharing are
unavailable and the voice UI says so.

## Mobile optimisations

- 44 px minimum touch targets everywhere (`screens::TOUCH_TARGET`);
- lazy `ScrollArea` lists (spaces, DMs, messages, members, participants);
- history and space details are cached per id; WS `ready` invalidates
  message history so missed activity can reload on demand;
- network strictly on worker threads (`mpsc` receivers polled in
  `update`, plus `ctx.request_repaint()` from workers on completion);
- WS reconnect with backoff (1s → 30s cap) and a full-catalog `ready`
  resync, so backgrounding the app never leaves a stale roster;
- release profile `opt-level = "s"` + `strip`, cargo-apk `strip = "strip"`,
  one universal APK (arm64 + armv7 + x86_64).

## Build, test, release

```bash
pnpm --filter @veyvox/mobile test        # Node parity tests (no Rust needed; runs in `pnpm -r test`)
pnpm --filter @veyvox/mobile typecheck   # versions, deps, Android-only gates
cargo test -p veyvox-mobile               # Rust unit tests (state/api/ws/voice/screens)
cargo run -p veyvox-mobile               # desktop preview of the phone UI
pnpm --filter @veyvox/mobile build:apk   # cargo test + cargo-apk + aapt/apksigner verify → dist/Veyvox-<version>-android.apk
```

CI (`.github/workflows/mobile-android.yml`, reusable like
`native-sdr-capture.yml`): actionlint → Java 17 + Android SDK and Build Tools
34.0.0 + NDK 27.0.12077973 (isolated SDK view so runner defaults don't
override the versions) → Rust stable + Android targets → structural check →
pinned `cargo-apk 0.10.0` → `build-android.mjs` (locked host tests, ephemeral
keystore on PRs; dedicated secrets, fail-closed, on tags) → canonical
selection of the signed `target/release/apk/veyvox_mobile.apk`, then
`aapt dump badging` (package, versionName, SDK 28/34, INTERNET,
launchable activity) + per-ABI native library listing + `apksigner verify`
→ `android-apk` artifact. A second job boots an API-34 x86_64 emulator,
checks the digest, `adb install`s the APK, cold-opens the launcher
activity with `monkey` and checks that its process is alive and its
activity is foregrounded. `ci.yml` requires both
jobs in the `Build & test` gate alongside lint, image and native builds.

Releases (`release.yml`): `mobile-apk` runs the same reusable workflow
on every tag push (with the repo secrets, so the tag APK carries the
dedicated release certificate). The APK artifact is deliberately named
`android-apk` so the desktop `validate` job (which downloads
`release-*`) keeps assembling exactly its four groups and
`validateDesktopRelease` still sees 16 assets. The existing publisher
requires `--android-directory`, hashes the downloaded APK against its
sidecar and uses the same upload host, release ID, and immutable asset
checks for all 17 files. It re-lists and verifies the complete remote
inventory before making the draft public.

Versioning is lockstep: `scripts/bump-version.mjs` discovers
`packages/mobile/package.json` automatically and `updateRustVersion`
bumps `Cargo.toml` + the `Cargo.lock` stanza in the same run;
`version-consistency.test.ts` + `mobile.test.mjs` fail on any drift.

## License justification

New Rust dependencies, all permissive and at arm's length: `egui` /
`eframe` (MIT/Apache-2.0), `winit` (Apache-2.0), `log` (MIT/Apache-2.0),
`android_logger` (MIT/Apache-2.0), `serde` / `serde_json`
(MIT/Apache-2.0), `ureq` (MIT/Apache-2.0), `url` (MIT/Apache-2.0),
`uuid` (MIT/Apache-2.0), `chrono` (MIT/Apache-2.0), `tungstenite`
(MIT/Apache-2.0), `cargo-apk` (build-time only, MIT/Apache-2.0). No
GPL/AGPL/SSPL/BUSL/non-commercial crate was added, per `AGENTS.md`.
