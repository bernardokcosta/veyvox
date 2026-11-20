# Spec: screen-sdr-recovery

See [initiative](README.md) for shared commands and delivery gates. The existing
[SDR design](../2026-10-24-windows-sdr-capture.md) still governs capture consent,
color conversion and native packaging.

## Objective and known behavior

An active Windows Force SDR share of a whole HDR monitor should survive
recoverable display-mode changes. In `capture_session.cpp` the capture loop
reads display color metadata before conversion; any exception from that lookup
currently becomes a terminal `source-color-unsupported`. A DXGI device failure
also ends the session. `sdrScreenCapture.ts` disposes the generated video on
either terminal notification, and `screenShare.ts` shows the same generic
warning. Transient metadata failure during HDR/topology changes is a candidate,
not a confirmed explanation for the game's incident.

## Behavior and tests

- First reproduce with a whole monitor under HDR, switching HDR or display
  mode and exercising the game's fullscreen/alt-tab path if available. Capture
  only scoped failure stage/reason for diagnosis; do not send monitor identifiers,
  window/app names, native handles or arbitrary error text in central logs.
- Handle only a verified recoverable interruption with bounded in-session
  recovery of the same provably authorized display. Revalidate that identity
  before resuming; a screen index, origin/position, or potentially reused
  handle alone is not sufficient. Drop frames with uncertain metadata, release
  stale GPU resources as required, and resume corrected SDR on the same
  published track with monotonically increasing timestamps and no duplicate
  audio track. See Microsoft's [capture pool guidance](https://learn.microsoft.com/windows/apps/develop/media-authoring-processing/screen-capture#react-to-capture-item-resizing-or-device-lost).
- Keep permanent invalid/ambiguous origin or display removal terminal.
  Existing user stop, room teardown, navigation and consent revocation cancel
  recovery immediately. If source identity, borderless authorization, valid
  SDR output, or the recovery deadline cannot be satisfied, stop and explain
  the need to reselect. Do not reprompt, switch targets, disable HDR or fall
  back to raw video automatically. Window capture is not the reported case.
- Add deterministic native tests for the reproduced transient condition plus
  exhausted recovery, replaced/missing display and late-frame cancellation.
  Exercise existing ownership and teardown tests:
  `pnpm --filter @veyvox/desktop exec vitest run src/sdrCapture.test.ts
  src/sdrCapture.borderless.test.ts src/sdrCaptureTransport.test.ts` and
  `pnpm --filter @veyvox/web exec vitest run src/utils/sdrScreenCapture.test.ts
  src/utils/screenShare.sdr.test.ts`.
- Run the matching native test (`node packages/desktop/scripts/build-sdr-capture.mjs
  --arch x64 --test` on Windows x64, or `--arch arm64` on matching Windows ARM64)
  and verify generic recovery with an installed desktop on actual HDR hardware
  and a remote viewer. That test must show resumed SDR without manual restart,
  stable audio, and no ownership relaxation or unbounded resources.
- Closing the reported *The Last of Us Part II* incident also requires a
  before/after whole-monitor run with the game on HDR hardware, or a controlled
  equivalent proven to trigger the same native failure stage and reason.
  If the original trigger cannot be established or retested, report the game
  incident as pending even if generic HDR recovery passes.
