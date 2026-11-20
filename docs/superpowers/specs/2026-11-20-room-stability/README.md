# Spec: Room stability without lowering screen-share quality

**Status:** Approved by the user on 2026-11-20.
**Implementation:** [Room stability implementation plan](../../plans/2026-11-20-room-stability.md).

The target is a one-hour call with ten total participants, two concurrent
1080p60 screen shares and an active Juno table. This is a repeatable test
profile, not a new quality ceiling. Existing manual quality choices and higher
tiers remain available under the existing host policy.

## Capability map

| Module | Responsibility | Depends on |
| --- | --- | --- |
| [juno-sync](SPEC-juno-sync.md) | Avoid repeated state reads while retaining live updates and recovery | — |
| [juno-media](SPEC-juno-media.md) | Reduce bytes and decoding work for visible game art | — |
| [screen-auto](SPEC-screen-auto.md) | Select a high-quality preset and recommend bitrates by codec | — |
| [screen-sdr-recovery](SPEC-screen-sdr-recovery.md) | Keep an authorized full-display SDR share alive across recoverable capture interruptions | — |

Implementation order: Juno sync → Juno media → screen Auto → SDR recovery.
They are independently verifiable. The combined call test follows the separate
checks; it is not a substitute for an HDR hardware test.

## Evidence and limits

- On 20 November UTC, the affected room had 5–6 participants. LiveKit resumed
  sessions during two bursts that overlapped abnormal chat WebSocket closes
  and Juno timeouts. There were no corresponding Nginx 429s or 5xx responses.
  CPU averaged about 94% idle; guest egress reached about 33 Mb/s over a
  ten-minute sample. This does not measure external uplink headroom or
  short-lived contention.
- The Juno card inventory is 4.4 MB; the original music is another 4.4 MB.
  These are inventory sizes, not a page-load payload. The earlier incident
  window had no Juno static requests in the available Nginx log; the later
  window served about 2.6 MB of art. Neither proves that assets caused the
  disconnects.
- The user reported Force SDR stopping while sharing the whole HDR monitor
  with *The Last of Us Part II*. The terminal behavior exists in source and
  tests, but the native error that triggered it has not been identified.

## Delivery and acceptance

- Use existing TypeScript strict code, Vitest and the Windows native tests.
  Follow subsystem and localization conventions; update their docs with the
  implementation. Do not add services/dependencies or change REST/WS contracts,
  capture IPC authorization, production limits, or deployment in this phase.
- Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and
  `pnpm --filter @veyvox/desktop build:ts`. Check `pnpm dev:server` and
  `pnpm dev:web` independently. Each module lists focused tests.
- For the combined test use two continuously moving 1920×1080/60 sources with
  capable receivers requesting both streams at full quality (other than their
  own publication), on a measured healthy link with headroom for every
  subscription. Keep voice active and follow the [shared-NAT Juno profile](SPEC-juno-sync.md).
  After a one-minute warm-up, sample received resolution and decoded FPS in
  five-second windows for the rest of the hour. For each watched stream on
  each receiver, require at least 95% of windows at 1920×1080 and at least
  55 decoded FPS, no individual freeze exceeding one second, and total
  frozen time at most 1% of the measured period.
- Record actual codec, bitrate, packet loss, unexpected chat/voice disconnects,
  Juno timeouts, Juno 429s and external egress when available. Require zero
  unexpected disconnects, Juno timeouts and Juno 429s across the full test.
  Compare against the unchanged build on the same hardware/network without
  accepting a sub-target stream merely because the baseline was also poor.
  A degraded-link pass is a separate recovery check, not a promise of 60 FPS
  where the connection cannot carry it. Report blocked hardware or participant
  gates explicitly; unit tests do not establish production stability.
