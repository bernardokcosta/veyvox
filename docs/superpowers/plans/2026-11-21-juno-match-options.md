# Juno Match Options: Special Cards + Stacking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Juno lobbies gain two host-owned match options — special (rare) cards on by default and draw stacking off by default — with a neon "+N" overlay and a workbench demo.

**Architecture:** `JunoRooms` owns a per-table `{specials, stacking}` lobby config (host-only `options` command, frozen into the round at start); the engine tracks `round.stackDraw` and only accepts +2/+4 continuations or the full take-draw while pending; the client renders a digit-tile "+N" overlay from cropped supplier art.

**Tech Stack:** TypeScript strict, Fastify, React 19, i18next, sharp (asset crop only).

**Spec:** User decisions 2026-11-20 (chat): specials = rare trio (memory/intoxicated/pizza), default ON, off = classic 108; stacking default OFF, +2/+4 freely interchangeable while a stack is pending, victim without one draws the total, empty-hand mid-stack wins immediately; neon digit art supplied (`Imagem do ChatGPT 20 de nov. de 2026, 19_45_58-1.png`, 1448×1086, 362px tiles) with pulsing overlay; demo in the preview workbench.

**Status (2026-11-21):** implementado e verificado — build 0, typecheck 0 erros, lint OK, i18n sem findings, server completo 211 arquivos/2407 testes verdes, web completa 437 arquivos/4336 verdes (inclui e2e Juno). Pronto para revisão final.

## Global Constraints

- TypeScript strict, no `any`; complete implementations only, no TODO/stubs.
- No new runtime dependencies (sharp is already in the repo for tooling).
- `docs/systems/juno.md` (+ `api.md` for the new command) updated in the same change.
- Web build fails on literal UI strings: user-facing copy only via catalogs (`en` + `pt-BR` new keys; other locales fall back to `en`).
- DB workflow: no schema change expected; if one appears, edit `schema.ts` → `db:generate` → commit both, never hand-edit `drizzle/*.sql`.
- Asset workflow: crop from the supplied PNG with `sharp`; register each output in `packages/web/public/games/juno/manifest.json` (sourceFile, sourceSha256, crop, dimensions, bytes, sha256); provenance paragraph in `packages/web/public/games/juno/README.md`; pin output hashes in `packages/web/src/components/games/junoAssets.test.ts`; leave `scripts/gen-juno-compact.mjs` outputs untouched unless the script itself covers `ui/`.
- Reduced motion: overlay pulse/glow disabled under `prefers-reduced-motion`, static "+N" remains.

## Review Focus

- A +2 played on a +2 of another color while a stack is pending must be accepted (free stacking), but the same play with no pending stack and mismatched color/face must be refused — Task 1 pins both in `actInRound` tests.
- A victim holding no +2/+4 draws exactly the accumulated total (deck recycle included) and loses the turn with no `drawnCardId` continuation — Task 1 pins `draw {amount: total}` and turn advance.
- Playing the last hand card as a stack wins immediately without victim draws — Task 1 pins `result: 'emptyHand'`.
- A 45s timeout or departure with a pending stack draws the total for the victim (or preserves turn order for departures) instead of hanging the round — Task 1 pins timeout; departure reuses the existing engine path with a regression test.
- An `options` command mid-round, by a non-host, or on an old host must be refused/ignored while lobby configuration by the host works and freezes at start — Task 3 pins each case.

---

### Task 1: Engine — specials deck, stackDraw, frozen options

**Files:**
- Modify: `packages/shared/src/juno.ts` (types)
- Modify: `packages/server/src/games/juno.ts` (engine + rooms)
- Test: `packages/server/src/games/juno.test.ts`, new `packages/server/src/games/junoStacking.test.ts`

**Interfaces:**
- Consumes: existing `JunoRooms`, `startRound`, `actInRound`, `createJunoDeck`.
- Produces:
  - `JunoAction` += `{ type: 'options'; specials?: boolean; stacking?: boolean }`
  - `JunoView.options: { specials: boolean; stacking: boolean }`, `JunoView.stackDraw: number`
  - `JunoSnapshot.supportsOptions?: boolean`
  - `createJunoDeck(memory=false, intoxicated=false, pizza=false, specials=true): JunoCard[]`
  - `startRound(people, now, memory=false, intoxicated=false, pizza=false, specials=true, stacking=false): JunoRound`
  - `canPlayJuno(card, hand, top, color, stackDraw=0): boolean` — `stackDraw>0` ⟺ face is `draw2|draw4`
  - Round: `{ specials: boolean; stacking: boolean; stackDraw: number }`

- [ ] **Step 1: Write failing tests** in `junoStacking.test.ts`: specials-off deck is exactly 108 with no memory/intoxicated/pizza faces; +2 on off-color +2 with pending 2 accepted and pending becomes 4; victim draw takes 4 and advances with no `drawnCardId`; +4 stacks onto +2; final-card stack wins with `result: 'emptyHand'`; timeout with pending stack draws the total; `options` mid-round/non-host refused; options frozen at start (change lobby options after start refused).
- [ ] **Step 2: Run** `pnpm --filter @veyvox/server exec vitest run src/games/junoStacking.test.ts` — expect FAIL (missing symbols/behavior).
- [ ] **Step 3: Implement** in `juno.ts`: deck gate; round fields; `options` command (host-only, `!table.round`, at least one of `specials`/`stacking` defined, else `juno_invalid_move`); `startRound` builds the classic 108 when `!specials` and records frozen flags; `actInRound` stack branch (pending>0: only draw2/draw4 free plays accumulate + advance, or `draw` takes all + clears + advances; all other moves incl. `pass` refused, `announce` still allowed); win-on-empty; timeout draws pending total; departures keep existing order logic; stalemate/drawn-card checks receive `round.stackDraw`.
- [ ] **Step 4: Re-run** the task's tests plus `src/games/juno.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(juno): stacking engine and specials option`.

### Task 2: Bots and shared highlight helper

**Files:**
- Modify: `packages/server/src/games/junoBot.ts` (`chooseJunoBotAction(hand, top, color, drawnCardId, stackDraw=0)`: pending>0 → play owned draw2/draw4 else `draw`)
- Test: `packages/server/src/games/junoBot.test.ts` (stack continuation + forced take)
- Callers of `canPlayJuno`/`chooseJunoBotAction` updated for the new trailing param (server engine, web `JunoMatch.tsx`, e2e helpers).

**Interfaces:**
- Consumes: Task 1 `stackDraw` semantics.
- Produces: bot stack behavior; no signature changes beyond the trailing optional param.

- [ ] **Step 1: Write failing tests** (bot stacks +2 onto pending 4; bot without draw card issues `draw`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** minimal bot branch + caller updates.
- [ ] **Step 4: Re-run** bot + engine suites — expect PASS.
- [ ] **Step 5: Commit** `feat(juno): bots play the stack`.

### Task 3: Protocol — options command, snapshot, routes

**Files:**
- Modify: `packages/server/src/routes/juno.ts` (commandSchema: `'options'` in type enum, `specials`/`stacking` boolean props, `allOf` requires at least one for `options`; route passes through — `JunoRooms.command` already receives the full body)
- Test: `packages/server/src/routes/juno.test.ts` (schema accepts `options`; `supportsOptions: true` present; unknown-field 400 preserved)
- Docs: `docs/systems/api.md` (options command + `supportsOptions`), `docs/systems/juno.md` (transport paragraph: options are host lobby state, not capability flags; old hosts 400 unknown commands)

**Interfaces:**
- Consumes: Task 1 command/rooms behavior.
- Produces: wire contract for Task 4; `supportsOptions: true` on every new-host snapshot.

- [ ] **Step 1: Write failing tests** (POST `options` as host in lobby returns new `options` in view; non-host 400; mid-round 400; snapshot root has `supportsOptions: true`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** schema + docs lines.
- [ ] **Step 4: Re-run** route tests — expect PASS.
- [ ] **Step 5: Commit** `feat(juno): options wire contract`.

### Task 4: Lobby checkboxes + guide + locales

**Files:**
- Modify: `packages/web/src/components/games/JunoLobby.tsx` (host-only checkboxes bound to `game.options`, `command({type:'options',...})`; read-only line for others; hidden entirely when `snapshot.supportsOptions !== true` and no `game.options`)
- Modify: `packages/web/src/components/games/JunoRules.tsx` (new `stacking` guide section rendered when `game?.options?.stacking`, plus specials note)
- Modify: `packages/web/src/locales/en/voice.json`, `packages/web/src/locales/pt/voice.json` (keys: `juno.options.specials`, `juno.options.specialsHint`, `juno.options.stacking`, `juno.options.stackingHint`, `juno.stackPending` with `{{amount}}`, `juno.guide.sections.stacking`, `juno.guide.stacking.rules`, `juno.guide.stacking.limits`)
- Test: `JunoLobby.test.tsx` (host toggles send `options`; non-host sees text, no checkbox; old-host snapshot hides the block), `JunoRules.test.tsx` (stacking section only when enabled)

**Interfaces:**
- Consumes: Task 3 contract.
- Produces: `game.options` rendered; nothing downstream.

- [ ] **Step 1: Write failing tests** as above.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** lobby/rules/locales (en+pt only).
- [ ] **Step 4: Run** — expect PASS; run `pnpm check:i18n` — expect no findings.
- [ ] **Step 5: Commit** `feat(juno): lobby match options UI`.

### Task 5: Neon "+N" overlay with pulse

**Files:**
- Create: `packages/web/src/components/games/JunoStackOverlay.tsx` (`{ amount: number }`, renders `stack-plus` + one tile per decimal digit from `JUNO_ASSETS.stack`, `role="status"`, `aria-label` via `juno.stackPending`)
- Modify: `JunoMatch.tsx` (render when `(game.stackDraw ?? 0) > 0`; add `juno-stack-active` to the match root), `juno.css` (`.juno-stack-overlay`, digit sizing, `@keyframes juno-stack-pulse` + table glow; `@media (prefers-reduced-motion: reduce)` static), `junoAssets.ts` (`stack: { plus, digits: [...10 urls] }`)
- Test: new `JunoStackOverlay.test.tsx` (+4 renders `+`+`4` tiles with status text; +30 renders three tiles; reduced-motion CSS present via stylesheet assertion like the bidi test)

**Interfaces:**
- Consumes: Task 4 view field `game.stackDraw`; Task 6 asset URLs (coordinate paths: `ui/stack-0.webp`…`ui/stack-9.webp`, `ui/stack-plus.webp`).
- Produces: overlay component used by Task 7 demo.

- [ ] **Step 1: Write failing tests** as above (point `JUNO_ASSETS.stack` at the Task 6 paths first so the component contract is fixed).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** component + match wiring + CSS (pulse scale 1→1.12 + glow, 1.1s loop; overlay `pointer-events: none`, expires with `stackDraw` returning to 0).
- [ ] **Step 4: Re-run** — expect PASS.
- [ ] **Step 5: Commit** `feat(juno): neon stack overlay`.

### Task 6: Supplier digit art into the manifest

**Files:**
- Create: `packages/web/public/games/juno/ui/stack-{0..9,plus}.webp` (cropped 362×362 tiles via `sharp`, transparency via screen-blend-safe keying only if clean — otherwise ship opaque tiles and blend with `mix-blend-mode: screen` in Task 5 CSS; decision recorded here after visual check)
- Modify: `manifest.json` (`files` entries: sourceFile `Imagem do ChatGPT 20 de nov. de 2026, 19_45_58-1.png`, sourceSha256, crop `{left,top,width,height}`, dimensions, bytes, sha256), `public/games/juno/README.md` (provenance paragraph), `junoAssets.test.ts` (output hash pins)
- Source file `C:\Users\berna\Downloads\Imagem do ChatGPT 20 de nov. de 2026, 19_45_58-1.png` stays untouched outside the repo.

**Interfaces:**
- Consumes: nothing (independent; run early in parallel with Task 1).
- Produces: the 11 `ui/stack-*.webp` paths consumed by Task 5.

- [ ] **Step 1: Crop tiles with `sharp`** (grid 4 cols × 362px; rows: 0-3, 4-7, 8,9,+) and inspect output; choose transparency vs screen-blend, record the choice in the README paragraph.
- [ ] **Step 2: Write failing hash pins** in `junoAssets.test.ts` — expect FAIL (files absent).
- [ ] **Step 3: Write files + manifest + README**.
- [ ] **Step 4: Re-run** asset tests — expect PASS.
- [ ] **Step 5: Commit** `feat(juno): neon stack digit art`.

### Task 7: Workbench stacking demo

**Files:**
- Modify: `packages/server/src/dev/junoPreview.ts` + `junoPreviewCli.ts` (`reset(players, stacking=false)`; `/reset` schema gains optional `stacking` boolean; preview lobby issues `options` when true)
- Modify: `packages/web/src/dev/juno-pizza-preview.tsx` (stacking checkbox next to the player count; label in pt-BR matching the file's existing language)
- Test: `junoPreview.test.ts` (reset with stacking starts a stacking-enabled practice round), engine demo test `src/games/junoStacking.test.ts` gains `plays a complete scripted stacking round` narrating +2/+2/victim-take with logged amounts (the executable proof)

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: the user-facing demo surface.

- [ ] **Step 1: Write failing tests** (preview reset with stacking; scripted round reaching a +6 take).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** preview plumbing + workbench toggle.
- [ ] **Step 4: Re-run** — expect PASS; manually open `http://127.0.0.1:5173/dev-juno-pizza.html` with `pnpm preview:juno` and watch a stack resolve.
- [ ] **Step 5: Commit** `feat(juno): stacking demo in preview workbench`.

### Task 8: Docs + full verification + final review

**Files:**
- Modify: `docs/systems/juno.md` (options lifecycle, stacking engine rules incl. free +2/+4 continuation and take-draw, overlay + reduced motion, asset entries), `docs/systems/api.md` if the options command needs more than Task 3's lines.
- Verify: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm check:i18n`, Juno server suites + e2e, full web suite.

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: shippable change + review package.

- [ ] **Step 1: Update docs** (rules must match the implemented legality exactly).
- [ ] **Step 2: Run** full verification — expect green except known-flaky `voiceReconnectGrace` migration-history env failures (verify they also fail on the pristine tree if they appear).
- [ ] **Step 3: Request the single final review** (`review_final_gpt56`, new task = fresh budget); fix concrete findings; re-run affected checks.
