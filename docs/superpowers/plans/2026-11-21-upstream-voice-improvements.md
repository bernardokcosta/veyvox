# Upstream Voice Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the three Backspace voice improvements into one Veyvox PR without changing call routing or regressing fork features.

**Architecture:** Keep `AudioManager` as the owner of the Web Audio graph, with explicit activity holds from existing playback and voice owners. Keep `MainContent` as the owner of fullscreen chrome and `VoiceGrid` as the one renderer for desktop, mobile and Juno; the video filter changes tile presentation only.

**Tech Stack:** TypeScript, React, Zustand, Web Audio, LiveKit, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-upstream-voice-improvements.md`

## Global Constraints

- Work on `feat/upstream-voice-improvements` off `origin/master`; do not change or depend on PR #43.
- Keep one selected server, native account IDs and the existing media, API and socket paths. No federation, dependencies, schema or protocol changes.
- Keep TypeScript strict, use the existing i18n and glass conventions, and update the affected subsystem docs.
- Publish one PR only after validations and the mandatory external final review.

## Review Focus

- An idle suspend already sent to the browser must not beat a newer resume or release a newer call.
- A canceled/replaced Juno or soundboard playback must drop its hold even if loading or resuming is pending.
- Idle fullscreen controls must be usable by keyboard and coarse pointer without invisible overlap.
- A pending share or camera must remain watchable; no filter may change subscription or audio.
- Filtering/restoring the grid must preserve Juno and not reselect an obsolete focused tile.

### Task 1: Suspend idle audio without cutting off playback (#494)

- [ ] In `packages/web/src/audio/AudioManager.idleSuspend.test.ts`, reproduce eager initialization on input-volume changes, suspend after 1.5 seconds idle, no suspend during a mic/voice/one-shot hold, overlapping idempotent releases, and newer playback restarting while a suspend is in flight.
- [ ] Add regression coverage for lease release under stale `useLiveKit` connection attempts, and for Juno/music and soundboard ownership during replacement, cancellation or failure.
- [ ] Run the focused audio and connection tests and verify the new assertions fail on the current implementation.
- [ ] In `packages/web/src/audio/AudioManager.ts`, implement `acquireAudioSession(): () => void` for voice and `acquirePlayback(): () => void` for non-voice sources. Own scheduling, oscillator and input-volume initialization in the manager. Keep actual input acquisition and track replacement generation guards intact. Defer idle-browsing audio activation in `AppLayout.tsx` and avoid waking idle meters in `ChannelSidebar.tsx`.
- [ ] Wire the existing owners in `useLiveKit.ts`, `useAudioTrackPlayer.ts`, `junoMusic.ts`, `JunoSounds.tsx`, `soundboardPlayback.ts` and `SoundboardUpload.tsx`. Reuse the current audio graph; release on end, stop, cancel and errors.
- [ ] Run `pnpm --filter @veyvox/web exec vitest run src/audio src/hooks/useLiveKit.capture.test.ts src/hooks/useLiveKit.localRow.test.ts src/hooks/useLiveKit.streamRepublish.test.ts src/hooks/useLiveKit.streamResume.test.ts src/components/games/JunoSounds.test.tsx` and verify the affected callers separately as needed.

### Task 2: Focus video edge to edge (#496)

- [ ] In `packages/web/src/components/voice/VoiceGrid.test.tsx` and the existing fullscreen layout tests, reproduce fullscreen focus defaulting to an open strip, inability to reach hidden controls by keyboard, and fullscreen layout leaking into Juno/docked modes. Include DM and space voice surfaces.
- [ ] Run the focused tests and verify the new assertions fail.
- [ ] Wire `VoiceGrid({ participants, fullscreen?, chromeRevealed? })` from both `MainContent.tsx` call surfaces; default to existing behavior for mobile and non-fullscreen callers. Pass edge-to-edge and chrome state only to focused `StreamTile`/`VoiceUser`. Use existing reveal and glass patterns, keep the watch CTA available, and preserve Juno layout.
- [ ] Run `pnpm --filter @veyvox/web exec vitest run src/components/voice/VoiceGrid.test.tsx src/components/voice/VoiceControlBar.test.tsx src/components/layout/MainContent src/components/layout/MobileVoiceFullScreen.test.tsx`; verify actual bounds and hit areas in a disposable browser call.

### Task 3: Add a local video-only grid filter (#497)

- [ ] Extend grid, desktop-control and mobile-call tests to prove the default is unchanged, pending video stays watchable, voice-only tiles disappear from grid and strip, Juno remains, filtered focus clears, and the empty-state action restores all tiles.
- [ ] Run the focused tests and verify the new assertions fail.
- [ ] Add persisted `hideNonVideoParticipants: boolean` and `setHideNonVideoParticipants(hide: boolean): void` in `voiceStore.ts`. Reuse the shared `VoiceGrid` across desktop and mobile, filter display tiles only, and add a shared toggle for `VoiceControlBar` and the mobile voice header. Add localized `voice:controls.hideNonVideo`/`showNonVideo` and `voice:grid.noVideoParticipants`/`showAllParticipants` copy.
- [ ] Run the affected grid, control, mobile and i18n tests and verify the filter in a disposable browser call.

### Task 4: Verify the integrated change and publish

- [ ] Update the voice, sounds, mobile and localization subsystem docs for the behavior that actually shipped.
- [ ] Run build, lint, typecheck, i18n and the web suite; verify both dev servers start with disposable state. Record browser observations, and report any unavailable Safari or physical DAC coverage separately.
- [ ] Check the diff against `origin/master` for native-path regressions or restored federation code. Obtain the mandatory final review of the complete task.
- [ ] Commit reviewed changes, push the isolated branch, and open one PR to `master` referencing all three upstream PRs.

## Integration evidence

- Rebased onto `4882345c` after Juno PR #43 merged independently. The voice
  diff adds no peer routing and touches no server, shared, desktop or lockfile
  code.
- `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm check:i18n` passed.
  The web suite passed with eight workers (4377 tests); the Juno e2e, duos and
  stacking server suites passed (28 tests).
- In a disposable two-account Chromium/LiveKit call, the shared context was
  running with capture during the call and suspended without capture after
  leaving. With a synthetic camera, the collapsed fullscreen video element
  matched its 800×544 container and used `object-contain`. Tab revealed the
  member toggle; Enter expanded the strip without overlapping the video or
  call bar. The mobile-width view preserved both participants in the count
  with the filter on and subscribed to an unwatched synthetic screen share
  when the Watch action was pressed.
- No physical DAC, Safari, hardware camera, native screen picker or actual
  touch device was exercised. Coarse-pointer behavior is covered at the CSS
  contract level, not on hardware.
- The external review found that ending an unanswered outgoing DM could leave
  its pre-armed mic open. Regression coverage now checks an already opened
  capture, late permission completion, a replacement attempt, active space
  capture, and definitive socket refusals/ends. DM teardown is scoped to the
  matching native DM; there are no wire changes.
- The second review found a space retry could already own capture while the
  store still said `disconnected`. DM cancellation now also checks the existing
  LiveKit audio hold. Regressions in the manager and hook exercise the window
  before resume finishes.
