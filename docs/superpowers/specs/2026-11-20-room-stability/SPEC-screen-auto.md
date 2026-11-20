# Spec: screen-auto

See [initiative](README.md) for shared commands and delivery gates.

## Objective and boundaries

Give new users a ready-to-share **1080p60** target when the source, device and
host policy permit it. Today new profiles start at 720p60/VP9, and one VP9
matrix supplies the default bitrate even when another codec is negotiated.
The existing Auto button only controls bitrate; an automatic quality choice
must make it clear which settings are automatic and what is actually in use.

## Behavior and tests

- Make a high-quality automatic preset the starting choice for new/unset
  profiles. Prefer H.265 when local WebRTC support permits and use the existing
  compatible H.264 fallback if unavailable or required by a viewer. A
  capability check is not a hardware-encoder guarantee. Preserve explicitly
  chosen settings, including legacy configurations that cannot be reliably
  distinguished from manually chosen defaults. Preserve the existing manual
  VP9/H.264/H.265 choices and capture/audio preferences.
- In Auto, if HEVC capability is advertised but the initial publication fails
  with a specifically identified HEVC negotiation/encoder failure, clean up
  the failed publication and retry once with H.264 on the same still-authorized
  live capture. Do not reacquire the source, duplicate audio, or overwrite
  settings. Never retry this way for generic network errors, cancellation,
  capture errors, room/ownership loss or an unknown error. If the SDK/runtime
  cannot distinguish HEVC failure reliably, do not enable the HEVC-first
  rollout on the affected environment until the fallback is verifiable.
- Use one shared recommendation path for the UI, initial encoding, source-native
  scaling, live updates and reconnect. Calculate a default by resolution,
  frame rate and actual codec, including a separate H.264 fallback ceiling;
  keep the existing permitted custom bitrate, admin overrides and instance
  bounds authoritative. Do not run extra full-quality encoders solely to
  implement Auto or republish due to ordinary bitrate fluctuations. Keep
  existing congestion control and voice priority.
- Compare representative moving game footage and text/UI footage with the
  same source and viewing size. Record actual encoding/decoding, received FPS,
  bitrate, dropped frames and freezes before choosing values. Do not apply a
  blanket percentage reduction just because a codec is newer; retain a
  conservative recommendation where quality cannot be established.
- Test new/legacy/manual choices, unsupported HEVC, initial HEVC publish
  failure and fallback, the no-retry cases, viewer compatibility fallback,
  native and higher tiers, admin/custom precedence and settings sync after
  reconnect.
  Run `pnpm --filter @veyvox/web exec vitest run src/utils/screenShare.test.ts
  src/stores/voiceStore.codec.test.ts src/components/voice/StreamQualityControls.test.tsx`
  plus focused tests added for this module.
