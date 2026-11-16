# Pizza Maluca Correction Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan inline, task by task.

**Goal:** Match the clarified Pizza Maluca rule and make transferred cards visibly flour-covered.

**Architecture:** Reuse the authoritative exchange, projections and shared card styling. Roll uniformly from 1 through 5 before clamping to the original hand size minus one; retain independent, equally likely other-player recipients and atomic transfers. Densify the supplied edge-flour texture, capped at 50%, without changing assets or card identities.

**Tech Stack:** Existing TypeScript, Node crypto RNG, Vitest, React card presentation and CSS.

**Spec:** User clarification of 2026-11-16; existing subsystem contract in `docs/systems/juno.md`, updated with the corrected roll.

## Global Constraints

- Preserve at least one original card in every participating hand.
- No new dependencies, REST/WS shapes, hidden-card disclosures or animation mechanisms.
- Keep ordinary last-card victory, five-second pause and no incoming-card cascade.
- Update all 25 existing `voice:juno.pizza.rules` catalogs without adding keys.

## Review Focus

- Minimum roll must move a card from every eligible original hand, even if net counts match.
- Small hands must clamp a five-way roll rather than change the roll's probability distribution.
- Recipients can receive zero, all of a source's cards or more than five cards overall.
- Transfers preserve card identities and flour through play/recycling and private projections.
- Flour must be obvious at local-card and small opponent-back sizes without affecting clean cards.

## Task 1: Correct authoritative selection

Files: `packages/server/src/games/junoPizza.ts`, `packages/server/src/games/junoPizza.test.ts`.

- [x] Add deterministic regressions for rolls 1–5, clamping, minimum exchanges with unchanged counts, and receiving more than five.
- [x] Run the regressions and verify the old implementation fails.
- [x] Implement the fixed five-way roll, update obsolete zero-exchange assumptions and verify all Juno server tests.

## Task 2: Make flour visible and explain the rule

Files: `packages/web/src/components/games/{juno.css,junoAssets.test.ts,JunoRules.test.tsx}`, `packages/web/src/locales/*/voice.json`, `docs/systems/{juno,api,localization}.md`, `docs/superpowers/specs/2026-11-14-juno-pizza-maluca-design.md`.

- [x] Add a regression checking the shared flour style remains visible; verify failure before changing CSS.
- [x] Reinforce flour, retain clipping/texture, and update all rule translations and subsystem documentation.
- [x] Verify clean/marked faces and backs in a browser using the real assets and stylesheet.
- [x] Run affected tests, full suites, build, lint and i18n checks; start dev servers and record any unrelated failures.
- [x] Request the mandatory external Sol review of the complete initial change; resolve concrete findings.

## Execution evidence

- Red: nine new authoritative-exchange cases and the flour-style regression failed on the old implementation.
- Green: all 35 pizza server tests; rule/assets web suites, 30 tests.
- `pnpm build`, `pnpm lint`, `pnpm check:i18n` and strict standalone typechecking of `junoPizza.test.ts` passed.
- Browser comparison used original assets and actual CSS at 88px and 28px widths. A second check rendered the real `JunoMatch` with a four-seat fixture, marked/unmarked local cards and opponent backs.
- Screenshots: `C:/Users/berna/AppData/Local/Temp/opencode/pizza-fixed-45.png` and `pizza-fixed-match.png`.
- Vite startup/HTTP 200 passed. Server startup/health HTTP 200 passed on isolated port 39997 with a disposable database/uploads under the approved temp directory. Default port 3005 was occupied and its process was left untouched. Optional ffmpeg was absent.
- Full recursive run: desktop 623 passed / 18 skipped; server 2,375 passed / five failures in `src/ws/voiceReconnectGrace.test.ts`, all reporting invalid migration history. Those same five failures were observed in the initial investigation before any edits. No runtime database or unrelated reconnection code was changed to hide them. The recursive run stopped before a web summary; the full web suite was restarted independently.
- Ruling: preserve the existing atomic original-hand selection and last-card victory; neither is changed by the corrected roll.
- Visual correction after user feedback: the initial 45% flat underlay was rejected. The accepted version uses only densified supplied texture, a clean-center edge mask and 50% maximum opacity. No white background remains.

## User-requested extension: synchronized hands and playable preview

The initial correction passed external review. The user then clarified that real
hand contents/counts must change at the same departure/arrival instants as the
card flights, and requested a playable pizza-in-hand preview plus commit/push/PR.

### Design note

Problem: authoritative snapshots already contain the completed exchange, so hands
currently jump to their final contents before the decorative flights.

Approach: keep the authoritative store untouched. A match-local presentation
projection retains the immediately preceding view and uses one bounded public
flight schedule for both ghosts and displayed hands/counts. Departures follow
the pizza's roster/direction order; arrivals occur 700ms later. Display only
already-known own cards and aggregate opponent counts. No hidden identity mapping
is invented or exposed; mid-flight representative slot order is cosmetic.
Initial/reopened/late views and reduced motion render the committed state directly.
Cancellation, roster/access changes and resolution completion snap to that state.

Alternatives: changing server ownership progressively would complicate atomicity,
departures and reconnects; adding per-card public IDs would violate privacy.
Neither is needed for presentation timing.

The development-only preview will reuse `JunoRooms`, real commands/bots/private
snapshots and `JunoTable`, with a disposable in-memory table and an initial
identity-preserving pizza swap. It runs as a separate loopback-only process and
standalone dev HTML entry, never an authenticated production route or deck rule.
Its clock waits for the first action, and reset keeps revisions monotonic for
already-open player/spectator tabs.

- [x] Add failing timeline/projection and React lifecycle tests, then implement the shared schedule and match-local projection.
- [x] Add a tested loopback preview using the existing engine, starting with pizza in hand for 2–4 players.
- [x] Verify departure/arrival frames and play the preview in a real browser.
- [x] Re-run build/typecheck/lint/i18n and affected/full suites; request the one justified second review from the same Sol reviewer.
- [ ] Commit only this task on `fix/juno-pizza-exchange`, push and open a PR against `master`; report any validation limits explicitly.

### Extension validation

- The initial external review approved the original 35-file correction. The
  expanded presentation/preview is a material new scope and receives the one
  justified second review from the same reviewer, not a different reviewer.
- New timeline, hook lifecycle, geometry fallback, mid-flight reduced-motion and
  preview tests were observed failing before their implementations/corrections.
- Real-browser player trace: 11 actual ghosts, hand 6 → 4 on departure, then
  4 → 5 → 6 → 7 on arrival, with three permanent flour markers and zero
  mismatching sampled frames outside boundary tolerance.
- Separate real-browser spectator trace: 13 ghosts, 933 sampled frames, zero
  aggregate-count mismatches outside boundary tolerance, and no private hand.
- Accepted edge-only visual screenshot:
  `C:/Users/berna/AppData/Local/Temp/opencode/pizza-edge-texture-match.png`.
- The previous five reconnection failures passed with `DB_PATH=:memory:`. This
  isolates test database state instead of reading the checkout's runtime DB.
  The full isolated server suite passed: 210 suites / 2,385 tests. Desktop:
  37 suites / 623 passed / 18 skipped.
- Full web run found one invalid preview-only color token; it was replaced with
  existing `text-accent-primary`. The color-token and four affected suites then
  passed (33 tests). The repeated complete web suite then passed: 434 suites /
  4,293 tests. Combined current package results: 7,301 passed / 18 desktop skips.
- Build, full typecheck, lint, i18n, strict standalone typechecking of the new
  server tests and `git diff --check` passed. Production output contains no
  development HTML entry.

### Final-review findings and corrections

The second external review found two synchronization defects, not new scope:
render-delay drift between hand and ghost clocks, and fractional three-player
boundaries firing early after timeout truncation. Both were reproduced in failing
regressions and corrected without another external-review round.

- The hook now passes its preserved observation anchor to the effects.
  Native animations receive a common absolute start time, avoiding pending-play
  delay; impacts/cleanup use the same remaining duration.
- Shared flight boundaries and scheduled delays round upward to integer
  milliseconds. A truncating-timeout regression reproduces the old missing
  three-player updates at 1,800ms and 2,500ms.
- Browser verification with the real components and a 200ms-old observation:
  hand already reduced correctly, ghost clock 252.9ms at 255ms elapsed
  (2.1ms difference), with no pending play.
- Browser three-player verification: at 1,802ms counts were `[1,7,7]`; at
  2,502ms `[1,7,8]`, exactly the shared projection.
- The 26 timeline/effect/lifecycle regressions passed after these corrections.
  Final build/typecheck/lint/i18n passed. The complete frontend rerun on the final
  source passed all 434 suites / 4,300 tests. Together with the isolated server
  and desktop results, 7,308 tests passed (18 existing desktop skips).
