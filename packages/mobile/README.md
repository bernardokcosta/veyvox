# Veyvox Mobile (Android, 100% Rust)

Android-only native client for Veyvox. No iOS target exists and none is
planned: this crate builds one APK (`Veyvox-<version>-android.apk`).

- **100% Rust.** `egui` + `eframe` immediate-mode UI, `ureq` REST,
  `tungstenite` WebSocket types, `serde` wire models. No webview, no JS
  bridge, no Kotlin/Java sources in this crate (the APK bootstrap is
  generated at build time by `cargo-apk`, not committed here).
- **Preview based on the web `MobileShell`.** Tabs Spaces / DMs / You, pushed
  screen stack (`channel-chat`, `friends`, `settings*`, `members`,
  `group-dm-info`, `voice-full`, `user-profile`), floating composer,
  and voice signaling. This is not full visual or functional parity:
  audio, video and screen sharing are not available. See
  `docs/systems/mobile-native.md` for the mapping table.
- **Mobile optimisations.** 44 px touch targets, 56 px tab bar with
  safe-area inset, lazy `ScrollArea` lists, newest-first DMs, `opt-level
  = "s"` + `strip` release profile, worker threads for network so the
  egui frame never blocks.

## Layout

```
packages/mobile/
  Cargo.toml            # veyvox-mobile, permissive deps only (MIT/Apache/ISC/BSD)
  rust-toolchain.toml   # stable + Android targets
  android/icon.png      # launcher source (packaged as @drawable/ic_launcher by cargo-apk)
  src/
    main.rs             # eframe entry (also runs as a desktop preview)
    lib.rs              # VeyvoxApp + all screen bodies
    state.rs            # tabs, screen stack, spaces/channels/DMs/messages
    api.rs              # REST client (same routes as the web client)
    ws.rs               # realtime frames, DM-refusal scope guard
    voice.rs            # voice state machine (same rules as voiceStore)
    screens.rs          # bottom nav, headers, DM-call button, badge rules
  scripts/
    check.mjs           # `pnpm typecheck` — versions, deps, Android-only gates
    build-android.mjs   # `pnpm build:apk` — cargo test + cargo-apk + aapt/apksigner verify + versioned APK
  test/mobile.test.mjs  # `pnpm test` — structural checks + version lockstep (no cargo needed)
```

## Develop

```bash
# Node checks (no Rust needed — this is what `pnpm -r test` runs)
pnpm --filter @veyvox/mobile test
pnpm --filter @veyvox/mobile typecheck

# Rust unit tests (needs Rust stable)
cargo test -p veyvox-mobile

# Desktop preview of the phone UI (needs Rust stable)
cargo run -p veyvox-mobile

# Release APK (needs Rust + Android SDK 34 + NDK r27 + cargo-apk 0.10.0)
pnpm --filter @veyvox/mobile build:apk
# → packages/mobile/dist/Veyvox-<version>-android.apk (+ .sha256 sidecar)
```

## Release

The `CI` workflow builds the APK on PRs and main-branch pushes, verifies it
with `aapt`/`apksigner` (package id, versionName, SDK floor, INTERNET,
launchable activity, one native lib per ABI, valid signature) and boots
it on an API-34 emulator (install, cold-open, foreground activity). Download
`android-apk` from the Actions run after the emulator job passes. Preview
builds use separate ephemeral keys; uninstall a previous preview first
if Android rejects an update (uninstalling removes its local data). Every
`v*` tag release attaches `Veyvox-<version>-android.apk` alongside the
Windows/macOS/Linux installers and the container image. Tag builds sign
with the dedicated release keystore from secrets (fail-closed without
them); other builds use an ephemeral CI keystore. Desktop release
inventory validation is untouched — the APK travels as the separate
`android-apk` artifact, is digest-checked against its sidecar, and is
required on the public release.
