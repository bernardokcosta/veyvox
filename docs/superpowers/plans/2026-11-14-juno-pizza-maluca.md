# Juno Pizza Maluca Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans for native execution in this session. Steps use checkbox (`- [ ]`) syntax for tracking. Delegated implementation is an alternative only if selected by the user; final external review remains required.

**Goal:** Add the approved server-owned Pizza Maluca card, persistent flour, restrained synchronized card flights and supplied pt-BR cue, and remove the Games picker's highlighted bottom description.

**Architecture:** Extend the existing synchronous Juno engine, capability negotiation and private projections. The existing room lifecycle owns a 5,000ms pause; the client renders bounded cosmetic flights from public transfer counts and keeps flour on card instances. Reuse JunoSounds/AudioManager, existing card artwork conventions and scoped localization.

**Tech Stack:** Strict TypeScript, existing Node crypto RNG, Fastify 5, React 19, Zustand, scoped CSS, i18next and Vitest. Existing Sharp and locally available FFmpeg handle supplied assets; no added dependency.

**Spec:** `docs/superpowers/specs/2026-11-14-juno-pizza-maluca-design.md` (approved 2026-11-14, including the additional picker cleanup).

## Global Constraints

- No new service, dependency, database table, voice publication or global animation/capability framework.
- Never empty a hand through redistribution; uniformly select 0 through min(5, N - 1) cards from each pre-exchange hand.
- Never serialize transferred card IDs, faces, colors, hand indices or draw order in the public summary.
- Preserve authentication/voice/permission gates, native identity, private projection, practice/XP, conservation and retry/rate-limit protections.
- Media editions remain pt-BR only; relevant interface text uses all 25 released UI catalogs.
- Keep `pnpm build` in its fixed shared → server → web order.
- Never touch production/runtime `data/`, credentials, unrelated work or tags. Publication, deployment and commits are not authorized by this plan.

## Review Focus

- A hand of one card, or two before playing pizza, must not accidentally win through redistribution; pin the boundary and normal last-card exception in Task 1.
- A departure or an expiring report window during the pause must not resurrect a miss or steal the next turn's time; exercise cancellation and exact boundaries in Task 2.
- An older host rejecting unknown flags must not cause a mutation retry or a fallback under a different account; exercise both in Task 3.
- A recycled card, masked viewer or capped opponent fan must not lose flour identity or leak a hidden card mapping; cover projection and presentation in Tasks 2 and 4.
- Reopening, resizing or reconnecting during the effect must not replay sound, retain stale coordinates or leave invisible input blockers; exercise cleanup and reduced motion in Tasks 4 and 5.

## File ownership

- `packages/shared/src/juno.ts`: card/transfer/pause types, capabilities, limits and legality.
- `packages/server/src/games/junoPizza.ts` (new): bounded random redistribution only; no room, transport or UI ownership.
- `packages/server/src/games/juno.ts`: normal-play integration, announcement/report reconciliation, pause deadlines, rooms and private projection.
- `packages/server/src/games/junoBot.ts`, `packages/server/src/routes/juno.ts`: existing selectors and transport declaration plumbing.
- `packages/web/src/api/client.ts`, `stores/junoStore.ts`: same-session read negotiation and confirmed capabilities.
- `packages/web/src/components/games/JunoCard.tsx`, `junoAssets.ts`, `junoSoundCues.ts`, `JunoSounds.tsx`, `JunoMatch.tsx`, `JunoRules.tsx`, `JunoTable.tsx`: existing rendering/audio integrations.
- `packages/web/src/components/games/JunoPizzaEffects.tsx` and `junoPizzaGeometry.ts` (new): Juno-local transient rendering and pure measured-layout geometry.
- `packages/web/src/components/games/juno.css`: aligned flour wrapper, bounded flights and reduced motion; preserve existing card/fan selectors.
- `packages/web/src/components/games/GamesPicker.tsx`: remove only the bottom paragraph.
- Colocated tests, existing public media/manifest/README, the 25 `voice.json` catalogs and relevant `docs/systems/*.md`: verification, provenance and current contracts.

## Task 1: Contract and bounded authoritative redistribution

**Files:** Modify `packages/shared/src/juno.ts`, `packages/server/src/games/{juno,junoBot}.ts`; create `packages/server/src/games/{junoPizza.ts,junoPizza.test.ts}`. Extend existing rare-card/bot tests only where behavior changes.

**Interfaces:**
- `JunoFace` gains `'pizza'`; `JunoCard` gains `floured?: boolean`; `JUNO_MAX_DECK_SIZE = 111`; export `JUNO_PIZZA_MS = 5_000`.
- Export `JunoPizzaTransfer { fromUserId: string; toUserId: string; amount: number }`.
- `JunoMove.pizzaTransfers?: JunoPizzaTransfer[]`; `JunoView.pizzaEnabled?: boolean`, `pizzaResolution?: { id: string; remainingMs: number }`; public player entries gain `flouredCardCount?: number`; `JunoSnapshot.supportsPizza?: boolean`.
- `redistributeJunoPizza(players: readonly { userId: string; hand: JunoCard[] }[]): JunoPizzaTransfer[]` in `junoPizza.ts` mutates supplied hand arrays/instances, marks transferred instances, and returns aggregated public counts only.
- Extend `createJunoDeck(memory = false, intoxicated = false, pizza = false): JunoCard[]` and `startRound(people: JunoPerson[], now: number, memory = false, intoxicated = false, pizza = false): JunoRound` without changing old defaults.

- [ ] Write `junoPizza.test.ts` cases `adds exactly one pizza only to capable decks`, `never sends the final card`, `splits recipients without transferring incoming cards again`, `permits a zero exchange`, and `conserves IDs and flour through seeded 2–4-player rounds`. Mock the existing crypto RNG as existing rare-card tests do, not a new production RNG injection.

  Representative assertions after fixture setup/exchange:
  ```ts
  expect(createJunoDeck(true, true, true)).toHaveLength(111);
  expect(state.players.every(player => player.hand.length >= 1)).toBe(true);
  expect(state.lastMove?.pizzaTransfers?.every(transfer => transfer.fromUserId !== transfer.toUserId)).toBe(true);
  ```
- [ ] Run `pnpm --filter @veyvox/server test -- src/games/junoPizza.test.ts`; verify failure is due to missing pizza contract/behavior.
- [ ] Implement uniform count/selection/destination sampling over pre-exchange hands. Build all selections before mutating hands; transfer at most 20 cards, never to the source, without reselecting incoming cards.
- [ ] Integrate pizza into ordinary legal play and bot selection, retaining active color and normal final-card victory. Resolve memory/intoxication first; a miss never transfers or marks anything. Reconcile announcements/reports using the approved deliberate-play versus transfer distinction.
- [ ] Run the new suite and existing `juno.test.ts`, `junoBot.test.ts`, `junoMemory.test.ts`, `junoIntoxicated.test.ts`, `junoReports.test.ts`; confirm old deck sizes and rare-card behavior remain unchanged.

## Task 2: Pause lifecycle, frozen cohorts and private transport

**Files:** Modify `packages/server/src/games/juno.ts`, `packages/server/src/routes/{juno.ts,juno.test.ts}`, extend `junoPizza.test.ts`.

**Interfaces:**
- `JunoRound.pizzaEnabled?: boolean`, `pizzaResolution?: { id: string; startedAt: number; endsAt: number }` are server-only state.
- Extend `JunoRooms.read(channelId, userId, supportsMemory = false, supportsIntoxicated = false, supportsPizza = false): JunoSnapshot` and analogous final parameter on `command(...)`.
- Ephemeral tables track `pizzaClients: Set<string>` alongside existing declarations. Route query gains `pizza?: string`, requiring exact `pizza=1&memory=1&intoxicated=1`.

- [ ] Write failing room/route cases for frozen 108/109/110/111 cohorts, malformed/duplicate flags, unsupported spectator/command refusal, allowed unsupported leave, and no extra secret fields in public transfer summaries.
- [ ] Write boundary cases: at 4,999ms all game actions remain refused without RNG; at 5,000ms the next turn is usable with its full timer. Reports neither expire during the pause nor revive if already expired. A two-card pizza play creates a post-pause report window only when eligible.

  ```ts
  expect(state.pizzaResolution?.endsAt).toBe(now + 5_000);
  expect(state.deadline).toBe(now + 50_000);
  expect(() => actInRound(state, nextUserId, { type: 'draw' }, now + 4_999)).toThrow('juno_invalid_move');
  ```
- [ ] Add departure cases before/at/after the deadline, preserving committed exchanges and normal host/turn/result cleanup; add bot cases ensuring no decision is scheduled during the pause. Masked/private projections must retain existing concealment.
- [ ] Run the focused server suites to see the new failures, then implement pause handling inside `actInRound`, `settle`, `remove`, `complete` and projection, without a second timer loop.
- [ ] At activation, extend valid report deadlines by 5,000ms and establish next deadline as effect end plus 45,000ms. Project report remaining time against effect end while paused. On early cancellation remove the unused pause extension; do not erase committed flour/transfers.
- [ ] Expose only aggregate flour counts for opponents and private instance markers for self/public discard. Preserve markers on public played cards, normal recycling and later hand projection.
- [ ] Run `pnpm --filter @veyvox/server test -- src/games/junoPizza.test.ts src/routes/juno.test.ts src/games/junoReports.test.ts src/games/junoMemory.test.ts src/games/junoIntoxicated.test.ts`; all cases pass with existing gates and budgets intact.

## Task 3: Read-only client negotiation and scoped state

**Files:** Modify `packages/web/src/api/{client.ts,client.test.ts}`, `packages/web/src/stores/{junoStore.ts,junoStore.test.ts}`.

**Interfaces:**
- Preserve existing `get(channelId, supportsIntoxicated?: boolean)` and `command(channelId, command, supportsIntoxicated?: boolean)` callers, adding `supportsPizza?: boolean` as a final parameter. Initial GET defaults to probing both enhancements; POST uses only confirmed snapshot support.
- Full GET query is `?memory=1&intoxicated=1&pizza=1`; exact `400 invalid_body` permits downgrade to intoxicated then memory-only, at most two read fallbacks. No other error and no POST uses fallback/replay.

- [ ] Add tests `downgrades two read probes within one session`, `does not retry a pizza command`, `does not fall back after identity changes`, and `retains flour and resolution against an older response`.

  Capture requested URLs with the existing HTTP test mock; assert this exact read-only downgrade suffix sequence:
  ```ts
  expect(querySuffixes).toEqual(['?memory=1&intoxicated=1&pizza=1', '?memory=1&intoxicated=1', '?memory=1']);
  ```
- [ ] Run `pnpm --filter @veyvox/web test -- src/api/client.test.ts src/stores/junoStore.test.ts` and confirm the new expectations fail.
- [ ] Extend the existing query construction, token/session guards and snapshot capability plumbing, retaining single-flight reads, cooldowns, reconnect reset and permission-loss cleanup.
- [ ] Re-run both suites; legacy/memory/intoxicated behavior and new negotiation/race cases pass.

## Task 4: Supplied media, persistent card rendering, rules and cue

**Files:** Modify `junoAssets.ts`, `JunoCard.tsx`, `junoSoundCues.ts`, `JunoSounds.tsx`, `JunoRules.tsx`, `JunoTable.tsx`, `juno.css` and their colocated tests. Add derived media under `packages/web/public/games/juno/{cards,ui}/` and `packages/web/public/sounds/`; update existing manifest/README and all 25 `voice.json` catalogs.

**Interfaces:**
- `JUNO_DUBBINGS['pt-BR']` gains `pizzaCard`/`pizzaSound`; `JUNO_SOUNDS.pizza = { sound: 'juno_pizza', gain: 1, lane: 'move' }`.
- `JUNO_ASSETS` gains `pizza`, `flour`, `flourParticle`, `flourImpact` URLs; target files are `cards/pizza.webp`, `ui/pizza.webp`, `ui/flour.webp`, `ui/flour-particle.webp`, `ui/flour-impact.webp`, and `/sounds/juno_pizza.ogg`.
- `JunoCard({ card, back = false, floured = false })` preserves original `<img>` behavior for clean cards; `card?.floured || floured` selects a shared decorative wrapper bearing the existing `.juno-card-art` layout class with front and inset `.juno-card-flour` overlay inside it. Update direct-child fan selectors to the shared class so wrappers and images have identical geometry.
- Rules receive `supportsPizza?: boolean` and include pizza only in supported lobbies/enabled rounds. Localized keys live under `voice:juno.pizza`: `title`, `rules`, `resolving`, `floured`.

- [ ] Add failing artwork/card/rules/audio tests: only real pt-BR edition resolves; flour survives hand-to-discard renders; clean cards stay clean; no private ID enters DOM; masked slots remain neutral; initial/same-ID/reconnect states are silent; confirmed pizza emits its cue once.

  After rendering a marked private card in the existing card test harness:
  ```ts
  expect(container.querySelector('.juno-card-flour')).toBeInTheDocument();
  expect(container.innerHTML).not.toContain('secret-id');
  expect(Object.keys(JUNO_DUBBINGS)).toEqual(['pt-BR']);
  ```
- [ ] Run focused web suites to verify expected failures before editing implementation.
- [ ] Normalize supplied artwork to standard 720×1056 geometry using existing rare-card conventions, documenting the actual crop/mask. Derive alpha-preserving WebPs for pizza/flour/particle; copy the supplied animated impact unchanged.
- [ ] Convert the complete WAV with the already available `C:/Users/berna/AppData/Local/Temp/opencode/11713-ffmpeg-tools/ffmpeg.exe` using `-c:a libvorbis -q:a 5`, with no trimming, volume change or normalization. Verify with the sibling `ffprobe.exe`; record source/output hashes, sizes, dimensions, alpha and duration in existing provenance files.
- [ ] Add the single edition, persistent overlay renderer, cue mapping and rules/copy in all 25 interface languages. Do not create other media editions or delete the picker description's reused catalog key.
- [ ] Run `pnpm --filter @veyvox/web test -- src/components/games/JunoCard.test.tsx src/components/games/junoAssets.test.ts src/components/games/junoSoundCues.test.ts src/components/games/JunoSounds.test.tsx src/components/games/JunoRules.test.tsx` and `pnpm check:i18n`; all pass.

## Task 5: Measured pizza orbit, bounded flights and paused match controls

**Files:** Create `packages/web/src/components/games/{JunoPizzaEffects.tsx,JunoPizzaEffects.test.tsx,junoPizzaGeometry.ts,junoPizzaGeometry.test.ts}`; modify `JunoMatch.tsx`, `JunoMatch.test.tsx`, `juno.css`.

**Interfaces:**
- `JunoPizzaEffects({ move, players, direction, viewerId, resolution, active })` consumes only `JunoMove | null`, public `JunoView['players']`, `1 | -1`, optional viewer ID, `JunoView['pizzaResolution']`, and a connected/non-stale presentation flag. It owns no game commands or authority.
- `junoPizzaGeometry.ts` exports `JunoPizzaPoint { x: number; y: number }` and `pizzaOrbitFrames(points: readonly JunoPizzaPoint[]): Keyframe[]` for a smooth closed path through measured occupied hands. Missing/degenerate anchors yield no unsafe animation.
- `JunoMatch` uses server remaining time anchored to `observedAt`, freezes report countdowns while resolving, and disables play/draw/pass/JUNO/report until resolution ends. A localized static status remains available for reduced motion and reopening.

- [ ] Write failing geometry/effect tests for 2/3/4 occupied seats, both directions, missing anchors, canonical card-height/3 sprite size, 0–20 private-safe back flights, and flour overlay alignment after a new play.

  Geometry assertions include an empty-anchor refusal and a closed orbit from valid measured points:
  ```ts
  expect(pizzaOrbitFrames([])).toEqual([]);
  expect(frames[0]?.transform).toBe(frames.at(-1)?.transform);
  ```
- [ ] Add once-only, initial-mount, polled-ID, stale/disconnect, resize, reduced-motion and unmount cleanup tests; add match tests showing no command from disabled controls and correct post-pause/report countdown behavior.
- [ ] Run `pnpm --filter @veyvox/web test -- src/components/games/junoPizzaGeometry.test.ts src/components/games/JunoPizzaEffects.test.tsx src/components/games/JunoMatch.test.tsx`; verify new failures.
- [ ] Implement the local decorative layer using actual `.juno-hand`, occupied opponent fan/seat and fallback discard rectangles, converted through `layoutPixels`. Order seats from the author in play direction, excluding vacancies; animate rotation separately from the smooth orbit.
- [ ] Render only real server-confirmed transfers as bounded back-card ghosts, with modest tilt/easing and small flour impacts. Cap at 20 simultaneous ghosts and 32 live trail particles. Cancel rather than replay on resized/missing anchors; mark IDs consumed even when motion is skipped.
- [ ] Integrate the layer beside existing `JunoEffects`, key it by game ID, and cancel all handles/listeners/nodes on access/scope loss or departure. Keep normal table geometry/input hit targets unchanged; preserve visible final authoritative hands.
- [ ] Re-run the suites and existing `JunoEffects.test.tsx`; all pass, with reduced-motion static state and no public faces/hidden IDs in flights.

## Task 6: Remove only the highlighted Games picker footer

**Files:** Modify `packages/web/src/components/games/{GamesPicker.tsx,GamesPicker.test.tsx}`.

**Interfaces:** No prop, route, translation key or action changes. Remove the final visible `<p>` using `voice:juno.description`; retain the header's `chooseGame` prompt and the lobby's separate accessible description.

- [ ] Add `does not render the bottom Juno description` to the existing picker suite; assert the dialog has no description paragraph, retains four game tiles and the Open Juno action, and still issues no command on opening.

  With the existing English-initialized i18n instance imported into the test:
  ```ts
  expect(within(dialog).queryByText(i18n.t('voice:juno.description'))).not.toBeInTheDocument();
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(4);
  expect(command).not.toHaveBeenCalled();
  ```
- [ ] Run `pnpm --filter @veyvox/web test -- src/components/games/GamesPicker.test.tsx`; see the new assertion fail.
- [ ] Remove only the bottom paragraph in `GamesPicker.tsx`, keeping its shared catalog entry.
- [ ] Re-run the suite; footer is absent and all existing focus/navigation/cancellation checks pass.

## Task 7: Full validation, visual evidence and contract documentation

**Files:** Update `docs/systems/{juno,api,sounds,localization}.md`; update this plan's checkboxes/evidence as work is actually verified. Keep the approved design as intent, not a fabricated completion report.

- [ ] Run affected server/web suites together, including seeded conservation, query schemas, bot timing, projection, state races, effects/audio/rules and the picker regression. Fix failures at their cause without weakening assertions.
- [ ] Run `pnpm check:i18n`, `pnpm typecheck`, `pnpm --filter @veyvox/server typecheck:e2e`, `pnpm --filter @veyvox/desktop build:ts`, then `pnpm build` in its existing sequential order and `pnpm lint`. If an existing suppression was actually fixed, use `pnpm lint:prune`, never hand-add suppression counts.
- [ ] Start both `pnpm dev:server` and `pnpm dev:web` with isolated test state and available ports, without changing runtime `data/`. Confirm clean startup; stop only processes started for this work.
- [ ] Use the existing browser tooling/fixture-table approach to run the real React table at desktop, short/scaled and mobile sizes. Record before/during/after for 2/3/4 seats, verify actual measured pizza size, card flights, persistent flour on hand/discard and footer removal, and inspect reduced motion.
- [ ] Verify the supplied MP4's movement by accessible playback/frames and actual Ogg decode/output without claiming unperformed listening or a live multi-device call. Asset failures must leave controls/server progress intact.
- [ ] Update subsystem docs to the implemented contract and the media provenance; record exact test/build/browser evidence and any honest limitations.
- [ ] Inspect the complete staged/unstaged/new-file diff, run whitespace checks, and request one final `review_final_gpt56` review covering the complete implementation, assets, catalogs, docs and UI cleanup. Fix concrete findings and rerun affected checks; no second reviewer type.
- [ ] Deliver a concise outcome with evidence and remaining limitations. Do not commit, push, release or deploy without separate user authorization.

## Plan review and execution selection

Recommended method: native execution by the main agent, following these tasks
and their red/green checks, with one final external review of the complete
implementation. The contract, timer and rendering tasks share tight interfaces;
keeping implementation in one context avoids divergent protocol assumptions.
The user approved native execution. The detailed steps above retain the original
implementation brief; the execution record below tracks delivered status.

## Execution record (2026-11-14)

- [x] Task 1: contract, bounded uniform redistribution and conservation; observed
  the missing-feature failures before implementation, then passing engine suites.
- [x] Task 2: pause, frozen capability cohorts, private projection, report/turn
  timing, departure and bot behavior. Added a regression ensuring the first
  post-pause command is not refused merely because time elapsed: resolution-end
  invalidation does not manufacture a new card-state revision.
- [x] Task 3: same-session read-only downgrade and confirmed capability plumbing;
  no mutation replay and no stale response overwriting flour/resolution.
- [x] Task 4: original pt-BR card/cue, alpha-preserving sprites, permanent flour,
  illustrated rules and all 25 interface catalogs; no new media edition/dependency.
- [x] Task 5: measured orbit, finite private-safe back flights, reduced motion,
  cancellation and paused controls. Visual QA found compact three-seat spline
  overshoot; a failing geometry test preceded clamping it to the measured hand
  envelope. No fixed screenshot coordinates were introduced.
- [x] Task 6: only the highlighted bottom picker paragraph removed; prompt,
  tiles/actions and shared accessible lobby description remain.
- [x] Main checks: root sequential build, lint, typecheck/i18n, server e2e
  typecheck and desktop TypeScript build all exit 0. Complete isolated server
  suite: 209 files / 2,368 tests pass. Complete web suite: 432 files / 4,279 tests
  pass. Both final suites used `--maxWorkers=2` for this machine's resource budget.
- [x] Real dev startup against isolated scratch state: API health 200 and Vite
  serving the actual React components. Only owned browser/server processes were
  stopped afterward; temporary preview entry points were removed.
- [x] Browser fixtures: 2/3/4 players, 1440×900 and 1280×800 desktop, 960×540
  short, 390×844 mobile and 1000×750 at 150% scale. Pizza/card-height ratios are
  approximately 0.3333; all tested flour/face rectangles align within 0.5px,
  only back textures fly, particles stay bounded at 32, controls are paused and
  no horizontal overflow was observed. Reduced motion creates no travel nodes
  and retains flour/static status. The four-tile picker has no bottom paragraph.
- [x] Actual AudioManager decode/output context: running 48kHz context, two
  channels, 2.2052917s, nonzero PCM peak approximately 0.9255. Supplied WAV content
  was not transcribed; no live multi-device voice call is claimed. The flour
  WebP retains identical alpha and visible RGB pixels; only fully transparent
  RGB values are optimized by WebP. Source/reference and derived hashes are in
  the manifest. Three/four-seat motion recordings and inspected screenshots are
  retained in the ignored task-scoped `.superpowers/sdd/` evidence directory.
- [x] Final whole-change external review: approved without actionable findings.
  The reviewer inspected all 70 changed/new files, ran 122 server + 185 web tests,
  exercised 3,000 real-crypto redistribution samples, and rechecked lint/i18n,
  whitespace, media provenance and ffprobe. No files were changed by the reviewer.
  Delivery remains source-only, with the unrelated desktop limitation below.

Execution environment: pnpm is available through `corepack pnpm`; add the already
installed pnpm 10.34.3 bin to process PATH for root scripts invoking nested pnpm.
Focused tests were run with `corepack pnpm --filter <workspace> exec vitest run
<files>`, because this checkout's pnpm forwards `test -- <files>` with a literal
separator that Vitest 5 treats as an unfiltered run. Server-wide tests used
`DB_PATH=:memory:`; dev startup used a separate scratch database/uploads directory,
never runtime `data/`.

Known unrelated limitation: `corepack pnpm -r test` stops in the unchanged desktop
`src/packagingDependencies.test.ts:128`, whose minimatch preprocessing-amplification
expectation does not throw with the installed dependencies (622 pass, 18 skip,
one failure). Desktop source, package manifests and lockfile were not changed.
An initial concurrently loaded full server run hit the existing stickers upload
test's 5s timeout; its focused rerun and both bounded-worker full reruns passed.
Existing Vite native-config/chunk warnings and jsdom's navigation notice remain.
No commit, push, release, production change or deployment was performed.

## Subsequent publication authorization

After that source-only delivery the user authorized making every suite green,
committing, pushing and publishing 1.17.16. The earlier desktop limitation was
traced to stale local node_modules (11.0.4) versus the already committed minimatch
11.0.5 lockfile. A frozen reinstall restored 11.0.5 and the unchanged 12-test
packaging suite passes, without a dependency or safety-assertion change.
Publication continues under `2026-11-14-juno-release-1.17.16.md`; production
deployment remains outside scope.
