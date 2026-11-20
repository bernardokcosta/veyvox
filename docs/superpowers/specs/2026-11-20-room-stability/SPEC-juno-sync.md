# Spec: juno-sync

See [initiative](README.md) for shared commands and delivery gates.

## Objective and boundaries

Reduce redundant requests when Juno is not being used without delaying table
discovery or live play. Reuse `JunoSession`, `junoStore`, and the existing
`juno_updated` invalidation. Keep reads private and server-authorized; leave
the API, request budgets, turn rules and public invalidation payload unchanged.

## Behavior and tests

- Keep prompt reads on voice entry, game open, visibility resume, WebSocket
  ready/recovery and relevant invalidations. A closed game must still discover
  an existing/new table and update the mosaic. Preserve confirmed-move cues
  for seated players even if their table is minimized. Do not use the visibility
  of one specific React component as proof that a player left.
- Keep the current five-second safety cadence for an active foreground table
  or a seated player on a visible page. Target a 30-second cadence for passive
  visible voice sessions; keep hidden-page timer work suppressed. At steady state
  with no invalidations that is at most two reads per minute instead of twelve,
  excluding the initial read.
- Verify the active profile separately: ten connected clients behind one
  observed HTTP source IP, four seated players, two foreground spectators, and
  four passive voice clients. On both builds, sustain one successful
  table-changing action per second for ten consecutive minutes, distributed
  across the players under the existing per-account budget. Verify at least
  60 accepted table-changing actions in each minute of that interval from
  server observations, not attempted commands; a run below that load is
  inconclusive. In the same interval count actual GETs (polls, invalidations
  and recovery) on both builds. The candidate must make fewer GETs than the
  baseline and at most 540 per rolling minute across that IP, below the
  600/minute route limit, with no Juno 429s or timeouts in the interval or during
  separate table discovery and active/passive role changes. Coalesce passive
  invalidations if needed without delaying foreground play, changing audio
  behavior, or replacing immediate discovery with polling. Do not raise
  request quotas to pass.
- Preserve account/origin/channel isolation, single-flight and one trailing
  invalidation, explicit Retry-After handling, stale-state guards, and mutation
  reconciliation without replaying a command.
- With fake timers, exercise active/idle transitions, background suppression,
  immediate recovery and dropped invalidation, in-flight ownership, and
  cleanup after context change. Run `pnpm --filter @veyvox/web exec vitest run
  src/components/games src/stores/junoStore.test.ts`.
