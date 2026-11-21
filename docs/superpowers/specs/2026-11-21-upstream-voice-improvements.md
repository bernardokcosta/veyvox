# Veyvox voice improvements from Backspace

Port [#494](https://github.com/TheZwiss/backspace/pull/494),
[#496](https://github.com/TheZwiss/backspace/pull/496) and
[#497](https://github.com/TheZwiss/backspace/pull/497) as one Veyvox PR. Use an
isolated branch from the fork's `master`; do not change or depend on Veyvox
PR #43.

## Capabilities and build order

| Capability | Responsibility | Dependencies |
| --- | --- | --- |
| `idle-audio` | Release the output device when no audio is in use | Existing Veyvox audio and voice lifecycle |
| `focused-fullscreen` | Give the focused stream or camera the full available image area | Existing fullscreen, chrome reveal and grid |
| `video-only-grid` | Filter participant tiles without affecting the call | Shared grid, including the new fullscreen layout |

Build order: idle audio → fullscreen layout → video-only filter → integration verification.

## Idle audio

- An unrelated click or a change to microphone gain must not create or resume
  an `AudioContext`. A context that is running suspends after 1.5 seconds
  without active capture, voice sessions or playback.
- Use idempotent holds owned by the audio consumers. Keep the existing Safari
  oscillator only while voice audio is active; let one-shots finish without
  forcing the oscillator on. A newer call, source or resume must not be
  suspended or released by stale work from a previous call.
- Preserve the user-gesture microphone pre-arm, input-denial handling, device
  routing, and reconnect generations. Acquiring the context or resuming it
  must retain the existing capture and playback failure paths.
- Review consumers outside the upstream patch: Juno music and effects,
  soundboard playback and upload preview, call tones, output test and
  notification sounds. No timer should cut off a clip or loop, and idle
  settings panels must not wake the audio interface.

## Focused fullscreen

- Reuse the existing fullscreen state, scale and `usePointerReveal` chrome.
  A focused share or camera fills a black, edge-to-edge viewport with no
  added padding, ring or radius. Preserve the video's aspect ratio.
- Start fullscreen video focus with its participant strip collapsed. Float
  the collapsed control clear of the call controls; an expanded strip
  reserves space beside the video rather than covering it.
- Focused overlays follow the existing fullscreen reveal and remain reachable
  with keyboard, touch and coarse pointers. Do not hide the watch action.
  Preserve docked behavior, the shared mobile grid, and Juno's own focus layout.

## Video-only grid

- Add an opt-in, persisted local display preference (off by default); provide
  accessible controls on desktop and mobile. Use the same filtering for the
  grid and its focused strip.
- Keep watchable screen-share tiles and enabled cameras that the viewer has
  not explicitly hidden. A camera may be pending attachment; do not use the
  presence of the video element itself to decide whether to mount its tile.
- Keep Juno visible, do not change subscriptions, audio, participant counts
  or permissions, and clear a filtered-out focused tile without restoring
  obsolete focus when the filter changes again. Where there are no visible
  tiles, offer a localized way to show everyone.

## Boundaries and verification

- Adapt individual behaviors rather than importing upstream branches. Keep
  the existing native account, server, socket and media routing. No federation,
  server endpoints, migrations, dependencies, or schema changes.
- Run regression tests for idle suspend/resume and concurrent audio ownership,
  fullscreen on both call surfaces, keyboard/touch reveal, the grid filter,
  Juno, and fork-only audio. Run `pnpm build`, `pnpm typecheck`, `pnpm lint`
  and `pnpm check:i18n`; verify browser geometry and media behavior with a
  disposable local call. Report hardware DAC or Safari checks separately if
  the device/browser cannot be tested.
- Update the affected `docs/systems` specs and confirm the final diff does not
  restore peer routing or touch the pending Juno PR. Obtain mandatory final
  review before publishing to the fork.
