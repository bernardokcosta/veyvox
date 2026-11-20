# Room Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce unnecessary Juno traffic and keep high-quality screen sharing usable by default and resilient to recoverable Windows SDR interruptions.

**Architecture:** Keep Juno on its existing store and WebSocket invalidations. Resolve the screen-share recommendation once per selected configuration through the existing voice pipeline, and recover SDR only inside the already authorized native display capture.

**Tech Stack:** TypeScript strict, React, Zustand, Vitest, LiveKit JS, Electron and Windows Graphics Capture/D3D11.

**Spec:** [Room stability](../specs/2026-11-20-room-stability/README.md).

## Global Constraints

- Existing private Juno reads, API/WS contracts, rate budgets, voice priority,
  capture IPC authorization, manual quality choices and host limits remain.
- 1080p60 is a target, not a ceiling or measured result. Do not lower default
  fidelity to make the load test pass or advertise unsupported HEVC.
- Reuse existing dependencies and local assets. No global cache/service-worker
  rewrite, extra service, production config changes or deployment.
- Order: Juno sync → Juno media → screen Auto → SDR → combined validation.

## Review Focus

- Juno seat, visible table, or audible cues must not become stale merely
  because a client is not focused on the game; successive eligible cues
  must survive the accepted load (Tasks 1 and 5).
- Compact URLs must never reveal hidden card faces, and high-density displays
  must still receive sharp art (Task 2).
- Legacy stored choices and a viewer's late H.264 fallback must not acquire
  the HEVC bitrate or overwrite the local preference (Tasks 3A–3B).
- A failed HEVC attempt must not consume the capture or leave duplicate audio;
  a lost room or user cancellation must not trigger retry, and a live Auto
  fallback must not be reversed by the first settings update (Task 3C).
- SDR recovery must stop if the monitor identity changes or the user stops
  during recovery, even if a stale native callback succeeds (Task 4).

---

### Task 1: Juno reads follow usage and freshness

**Files:** `packages/web/src/components/games/JunoSession.tsx`,
new `JunoSession.test.tsx` alongside it, `packages/web/src/stores/junoStore.ts`,
`packages/web/src/stores/junoStore.test.ts`, `docs/systems/juno.md`.

**Interfaces:** Keep `load(): Promise<void>`, `invalidate(channelId: string): void`
and `bind(target, connected)` in the current store. Implement the visible-page
safety cadence in the session using actual `presentedViews.size > 0` and
authoritative seated-player state; use `open` only as an explicit open trigger.
Reuse `readFlight`, `observedAt` and `Retry-After` rather than a separate fetcher.

- [ ] Add a fake-clock `JunoSession.test.tsx`: idle/no invalidation reads once
  on entry and then at 30 seconds, not at five; a seated player with the view
  closed and a foreground spectator retain the five-second safety interval.
  Navigate from the table to text and back while `open` remains true: a
  non-seated client follows actual presence, not that preference.
  Hide the document, advance the clock, and check zero timer reads; show it,
  reopen the table and send a new-table invalidation in separate tests, and
  assert immediate discovery. Verify channel/logout cleanup clears old work.
- [ ] Add a store test for an invalidation during a read: a burst leaves one
  trailing read, a confirmed recent read can satisfy a safety tick without
  postponing the next recovery deadline, and a new event during Retry-After
  does not bypass it. Reuse `JunoSounds.test.tsx` to pin down the ordinary
  live cue for a connected non-seated listener and the turn cue for a
  minimized seated player. Exercise two successive invalidations with
  different eligible moves: both cues must be started in order under the
  existing lane rules, without a duplicate or a silently skipped move.
- [ ] Run `pnpm --filter @veyvox/web exec vitest run src/components/games/JunoSession.test.tsx src/components/games/JunoSounds.test.tsx src/stores/junoStore.test.ts`.
  Expect new cadence/freshness assertions to fail before changing behavior.
- [ ] Implement the two cadences and use a recent authoritative refresh to
  avoid redundant safety reads, including after reconnect and visibility
  changes. Keep immediate discovery on relevant `juno_updated` and a fast
  open. Coalesce passive notification-triggered reads only if the existing
  eligible cue behavior remains intact. If the required load cannot be met
  without sacrificing cues or changing a wire contract, report the measured
  gate as blocked rather than silently muting test clients, dropping cues or
  raising the 600/min limit.
- [ ] Run `pnpm --filter @veyvox/web exec vitest run src/components/games src/stores/junoStore.test.ts`
  and document the chosen cadence and recovery triggers. Shared-NAT acceptance
  is Task 5, not inferred from this unit suite.

### Task 2: Responsive Juno art

**Files:** `packages/web/src/components/games/JunoCard.tsx`, `JunoCard.test.tsx`,
`JunoMatch.test.tsx`, `junoAssets.ts`, `junoAssets.test.ts` in that directory; `packages/web/public/games/juno/`
for derivatives, manifest and conversion recipe; update consumers only where
measured CSS sizes require an explicit `sizes` hint, plus `docs/systems/juno.md`.

**Interfaces:** Keep `junoCardUrl(card, back, dubbing): string` as the full-size
authority. Add a responsive helper returning `string | undefined` given that
approved URL; keep original `src` and add `srcSet` and `sizes` only where a
measured smaller rendition is shipped.

- [ ] Capture the cold/warm baseline with the same game fixture at mobile and
  desktop sizes and normal/high DPR. Record image URL, CSS size, natural size,
  and bytes. Include full-size/zoom scenes and confirm which art dominates
  the targeted small-card view before selecting variants.
- [ ] Add failing tests for a compact public face and back with correct width
  descriptors, original fallback and aspect ratio. Assert in the real hand
  that a hidden face emits no URL in either `src` or `srcset`. Test manifest entry size/hash,
  approved derivative-to-original mapping, and unchanged original art and cues.
  Run `pnpm --filter @veyvox/web exec vitest run src/components/games/JunoCard.test.tsx src/components/games/JunoMatch.test.tsx src/components/games/junoAssets.test.ts`;
  the derivative expectations must fail first.
- [ ] Generate derivatives offline using the existing `sharp` dependency in
  `packages/server` as a tool, not as a frontend runtime dependency. Record
  the exact inputs/settings in the asset recipe. Prefer one compact tier
  validated against CSS slot widths × DPR; do not add unneeded versions.
  Wire `JunoCard` to responsive candidates only after the private-face guard
  has selected the public image, and preserve original-only rendering where
  the comparison shows a loss.
- [ ] Rerun the focused tests and the game suite. Compare actual requests
  and screenshots for the baseline scenes. Keep variants only when the
  targeted cold view transfers at least 20% fewer image bytes without
  a noticeable loss of readability, alpha or geometry; report the measured
  result, not the repository size. Verify production asset serving in Task 5.

### Task 3A: Codec-specific recommendation and encoder ceilings

**Files:** `packages/web/src/utils/screenShare.ts`, `screenShare.test.ts`,
`livekitInternals.ts`; `packages/web/src/hooks/useLiveKit.ts` if its existing
update/reconnect path needs a split ceiling; `packages/shared/src/constants.ts`
for recommendations; `docs/systems/voice.md`.

**Interfaces:** Keep `buildScreenShareOptions(config: ScreenShareConfig): ScreenShareBuildResult`
and `resolveNativeOverdrive(...)` as the consumer path. Give their encoding
results distinct primary and H.264 fallback ceilings when those codecs are
different, both independently using the same recommendation and clamp rules.

- [ ] Add unit cases for standard and native-sized recommendations; permitted
  custom bitrate or existing absolute admin override wins, then host clamp
  applies. Verify distinct HEVC/H.264 ceilings through initial publish,
  quality changes, late viewer regression and reconnect (including the
  inactive encoder's cached settings). Run
  `pnpm --filter @veyvox/web exec vitest run src/utils/screenShare.test.ts`
  and verify that distinguishing the ceilings fails on the old implementation.
- [ ] Benchmark representative motion and text on the same content and
  recording settings. Keep VP9 as reference; record per-codec candidate
  values and actual received FPS, bitrate, freezes, readability and encoder
  behavior. Use a conservative, explicitly unbenchmarked recommendation for
  unsupported cells instead of automatically applying a blanket discount.
- [ ] Implement the shared codec recommendation, honoring saved manual
  choices. Extend the existing LiveKit regression and
  sender-update seams to preserve distinct ceilings rather than creating a
  second ongoing encoder or another bitrate control loop.
- [ ] Rerun the encoding tests; record recommendation precedence and what
  was measured. Verify delivered quality in Task 5.

### Task 3B: Auto preference and truthful UI

**Files:** `packages/web/src/stores/voiceStore.ts`, `voiceStore.codec.test.ts`;
`packages/web/src/utils/screenShareCodec.ts`, `screenShare.ts`;
`packages/web/src/components/voice/{StreamQualityControls.tsx,StreamQualityControls.test.tsx}`;
existing voice locales; `docs/systems/{voice,localization}.md`.

**Interfaces:** Distinguish selectable `ScreenShareCodecPreference` (`'auto'`
or an existing concrete codec) from concrete `ScreenShareCodec`. Keep the
typed recommendation from Task 3A available to the UI. Auto's HEVC-first
activation depends on Task 3C, not just the capability probe.

- [ ] Add migration/UI assertions: new or genuinely unset profile defaults
  to 1080/60/Auto/automatic bitrate; existing 720/60/VP9 and manual H.264/H.265
  are unchanged; unsupported Auto selects H.264 without a saved write; host
  policy does not persist fitted values. Selecting the Automatic preset
  restores quality/automatic bitrate but retains Force SDR and system-audio
  intent. Test requested Auto versus negotiated codec and effective bitrate.
  Run `pnpm --filter @veyvox/web exec vitest run src/stores/voiceStore.codec.test.ts src/components/voice/StreamQualityControls.test.tsx`
  and confirm the new preference expectations fail.
- [ ] Implement the new-profile preset and explicit entry into Auto while
  preserving all valid existing choices; keep H.264 as the Auto result
  until Task 3C demonstrates an eligible HEVC path. Use existing
  translation/catalog conventions.
- [ ] Rerun the focused tests and `pnpm check:i18n`. Confirm older clients
  and already persisted profiles do not acquire the new default silently.

### Task 3C: Recover from an identified first-publish HEVC failure

**Files:** `packages/web/src/utils/{screenShare.ts,screenShareCodec.ts,screenShare.test.ts,screenShare.sdr.test.ts}`;
`packages/web/src/hooks/{useLiveKit.ts,useLiveKit.streamRepublish.test.ts,useLiveKit.streamResume.test.ts}`;
`docs/systems/voice.md`.

**Interfaces:** Reuse the existing `publishScreenShare(...)` source/room
ownership transaction. The retry must consume the recommendation for H.264
from Task 3A without changing the preference from Task 3B. Store the explicit
Auto fallback on the current capture owner, not configuration or a stale
room. The initial settings effect, later quality changes and voice reconnect
must use that capture's effective result. Clear it on terminal ownership
loss or a new authorized capture; an explicit manual codec change still wins.

- [ ] Add publication tests for a reliably identified HEVC-only failure
  after capability succeeds: one H.264 attempt on the same live source,
  one audio publication, and no new picker. Network, unknown, aborted,
  ended-track and room replacement cases must not retry or adopt a late
  publication. In the hook tests, transition `isScreenSharing` to true,
  change FPS/bitrate and reconnect with the surviving capture; assert the
  H.264 sender remains effective and a second HEVC publication is not
  attempted. Then stop and start a new capture to verify the fallback does
  not leak. Run
  `pnpm --filter @veyvox/web exec vitest run src/utils/screenShare.test.ts src/utils/screenShare.sdr.test.ts src/hooks/useLiveKit.streamRepublish.test.ts src/hooks/useLiveKit.streamResume.test.ts`;
  verify the new fallback assertions fail for the targeted reason.
- [ ] Implement the bounded first-publish H.264 fallback only when the
  failing API stage identifies HEVC. Clean up partial SDK publication
  without disposing the original capture before that retry. Carry the
  effective fallback with that capture through the existing settings,
  sender and reconnect paths to prevent automatic republish loops. If the
  environment cannot distinguish the error, do not activate HEVC-first Auto
  there: record the fallback/validation limit rather than retrying generic
  `OperationError` or timeouts.
- [ ] Rerun the focused suites to verify the retry and the existing
  ownership/cleanup behavior. Document where HEVC-first was proven.

### Task 4: Recover Force SDR on the same authorized monitor

**Files:** `packages/desktop/native/sdr-capture/{capture_session.cpp,capture_session.h,capture_session_test.cpp,source_color.cpp,source_color.h,source_color_test.cpp}`;
the existing native smoke fixture, `packages/web/src/utils/{sdrScreenCapture.test.ts,screenShare.ts,screenShare.sdr.test.ts}`,
existing voice locales, and `docs/systems/{desktop,desktop-security,voice,localization}.md`.
Keep the existing bridge and permission contract unchanged.

**Interfaces:** Keep `CaptureSession` owner and renderer track alive during
recoverable interruptions. Private native reason classification and any
current-display identity verification belong in `capture_session` and
`source_color`; renderer `onSdrCaptureEnded` remains terminal only.

- [ ] Reproduce with installed Windows HDR, full monitor source, and a
  remote viewer. Use scoped local native diagnostics to identify the
  capture stage and recognized reason. Test HDR off/on or other display
  mode transitions; for the reported incident retain the *Last of Us Part II*
  run or evidence of a controlled same-reason equivalent. A generic
  transition is not proof of the game's failure. Record a blocked
  reproduction rather than implementing a catch-all retry.
- [ ] Once identified, inject the same native failure in deterministic
  tests: short transient resumes only same-monitor SDR, deadline expiry
  and changed/ambiguous output end it, stop/navigation/room teardown
  cancels delayed work, stale frames are retired, and successful recovery
  does not replace the live track or audio. Invalid metadata must never be
  interpreted as SDR by default. In `screenShare.sdr.test.ts`, an established
  track ending after a failed recovery must display one localized instruction
  to reselect the source with Force SDR still enabled, not the old copy to
  turn it off. Run the matching native `--test` command below and the Web
  SDR suite; confirm the new assertions fail before implementing.
- [ ] Keep recovery within the authorized live session with a two-second
  grace period after a confirmed first frame. Retry only the identified
  transient operation, at a bounded cadence, not arbitrary graphics/session
  errors. Re-validate the existing authorized item against a stable trusted
  display identity before resuming; never reopen by position/index or a reused
  handle. Clear stale WGC/texture work without breaking existing transport
  ownership, preserve monotonic timestamps and audio, and fail closed
  when identity/consent cannot be proven or the deadline is reached. Use
  the existing terminal event to show the new localized reselection message
  after an acquired share ends; do not alter the IPC or saved SDR choice.
- [ ] Run `node packages/desktop/scripts/build-sdr-capture.mjs --arch x64 --test`
  (ARM64 on matching hardware), then
  `pnpm --filter @veyvox/desktop exec vitest run src/sdrCapture.test.ts src/sdrCapture.borderless.test.ts src/sdrCaptureTransport.test.ts`
  and `pnpm --filter @veyvox/web exec vitest run src/utils/sdrScreenCapture.test.ts src/utils/screenShare.sdr.test.ts`,
  followed by `pnpm check:i18n`.
  Repeat the installed-HDR test and record continuation, color output and
  audio, plus permanent monitor loss and explicit stop. Keep the game
  incident open until its separate evidence gate is met.

### Task 5: Whole-room verification

**Files:** Write the verification evidence alongside the plan, with no
customer identifiers, room names or system secrets.

- [ ] Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and
  `pnpm --filter @veyvox/desktop build:ts`. Start `pnpm dev:server` and
  `pnpm dev:web` independently and confirm startup; verify responsive
  images serve from the production build, not only Vite's dev server.
- [ ] Reproduce the baseline and candidate on the same healthy hardware
  and network. Run the one-hour, 10-person/2-stream Juno scenario and count
  delivered FPS, resolution, freeze duration and errors as defined in the
  [initiative](../specs/2026-11-20-room-stability/README.md). For Juno verify
  the full ten consecutive minutes of 60 accepted actions/minute with
  four players, two spectators and four passive voice clients behind one
  observed HTTP source IP; require fewer GETs than baseline, at most 540
  per rolling minute, no `429` or timeout on the candidate.
- [ ] During that same sustained-load window count scripted eligible cues
  on audible passive listeners and on seated players with the table
  minimized. Compare cue starts by move against successful authoritative
  actions and existing lane/overlap rules; require no new skips, duplicates
  or missed turn cues. Switching away from the table must not mute audio or
  count as leaving. Do not mute/passivate test clients to pass the GET cap.
- [ ] Exercise a constrained link separately from full-quality acceptance.
  Document actual outcomes and blocked gates; do not infer production
  stability from passing tests or apply VM changes. Obtain the mandatory
  independent final review of the full implementation after validation.
