# Juno 6 players + dynamic XP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Juno supports 2–6 players (up to 5 bots) with dynamic XP (base + card/field/stability bonuses).

**Architecture:** Shared constants (`JUNO_MAX_PLAYERS=6`, `JUNO_BASE_XP` 120/80/40/20/10/5, `junoDynamicXp` helper) own the formula; server `buildJunoStandings` applies it; UI renders 6 seats (top row holds 2 when 5–6) and reads base table from shared.

**Tech Stack:** TypeScript strict, Fastify, Drizzle/SQLite, React 19, i18next.

**Spec:** User decisions 2026-11-20: 6 seats, up to 5 bots (`computer: 1–5`), extra top-row seats, dynamic XP from cards + field size + stability.

**Status (2026-11-20, round 3 — 2ª revisão corrigida, sem nova chamada externa pois o teto de 2 revisões foi usado):** consentimento de ampliação via `sixClients` (join/addBot exigem todos os humanos sentados com six); `sixRequired` cobre elenco inicial até o rematch; leave sem six retorna sucesso com game nulo; fórmula = média das mãos adversárias (duelo 0/10 → 135 pinado); lobby/tile usam capacidade negociada; ties com "base" nos 24 idiomas; e2e com asserções independentes da função.

## Global Constraints

- TypeScript strict, no `any`; complete implementations, no TODO/stubs.
- No new dependencies.
- `docs/systems/juno.md` updated in same change (schema/API/contract touch).
- DB workflow: edit `packages/server/src/db/schema.ts` → `db:generate` → commit both; never hand-edit `drizzle/*.sql`.
- Web build fails on literal UI strings: user-facing copy only via catalogs.
- Per AGENTS.md: architectural change ships with this design note; final external review required before delivery.

## Review Focus

- 6-player full round conserves all cards and settles with places 1–6 — expect dynamic XP ≥ base, ties equal.
- 7th join/addBot refused with `juno_full` — expect 400/409 contract unchanged.
- 2–4 player regression: old base values only grow by documented bonuses, never shrink below base.
- Masked/cursed projections and pizza transfers unchanged with 6 hands.
- Old clients without memory/intoxicated/pizza flags still get `juno_update_required` on enhanced rounds.

---

### Task 1: Shared contract — 6 players + dynamic XP helper

**Files:**
- Modify: `packages/shared/src/juno.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `JUNO_MAX_PLAYERS=6`, `JUNO_MIN_PLAYERS=2`, `JUNO_BASE_XP: Record<JunoPlace,number>`, `junoDynamicXp(place, ownCards, totalCompletedCards, completedCount, abandonedCount): number`; `JunoPlace=1|2|3|4|5|6`; `computer?: 1|2|3|4|5`.

- [ ] **Step 1: Write failing test** in `packages/shared/src/juno.test.ts` (new file if absent): base table 120/80/40/20/10/5; dynamic ≥ base; ties equal; winner bonus grows with opponent cards; 6-player full-room ≥ 4-player.
- [ ] **Step 2: Run it** `pnpm --filter @veyvox/shared test -- juno` — expect FAIL (missing exports).
- [ ] **Step 3: Implement** constants + helper (pure, integer, clamped 0–20 card bonus + field/stability bonuses).
- [ ] **Step 4: Re-run** — expect PASS.
- [ ] **Step 5: Commit** `feat(juno): shared 6-player contract and dynamic XP helper`.

### Task 2: Server engine — capacity, bots, standings, settlement

**Files:**
- Modify: `packages/server/src/games/junoStandings.ts`, `packages/server/src/games/juno.ts`, `packages/server/src/games/junoProgression.ts`, `packages/server/src/db/schema.ts`, `packages/server/src/utils/httpErrors.ts`
- Test: `packages/server/src/games/junoStandings.test.ts`, `juno.test.ts`, `junoBot.test.ts`, `junoProgression.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `buildJunoStandings` dynamic XP; rooms accept 6; `settleJunoRound` accepts 2–6 starters.

- [ ] **Step 1: Update failing tests** — standings expectations → dynamic values; `juno_full` on 7th seat; 5 bots; progression 6-player settlement + cardCount bound still `JUNO_MAX_DECK_SIZE`.
- [ ] **Step 2: Run** `pnpm --filter @veyvox/server test -- juno` — expect FAIL.
- [ ] **Step 3: Implement** — `XP_BY_PLACE` → shared base; place cast to `JunoPlace`; card/field/stability bonuses; `>= 6` capacity; bot pool `1–5`; progression length check `2–6`; schema place type `1|2|3|4|5|6`; `juno_full` text six seats.
- [ ] **Step 4: Run** `pnpm --filter @veyvox/server test -- juno` — expect PASS.
- [ ] **Step 5: DB generate** `pnpm --filter @veyvox/server db:generate` — commit schema + drizzle output together (even if no-op).
- [ ] **Step 6: Commit** `feat(juno): six seats and dynamic XP on the server`.

### Task 3: Web — 6 seats layout + base XP table

**Files:**
- Modify: `packages/web/src/components/games/junoSeats.ts`, `JunoMatch.tsx`, `juno.css`, `JunoLobby.tsx`, `JunoTile.tsx`, `JunoRules.tsx`
- Test: `junoSeats.test.ts`, `JunoLobby.test.tsx`, `JunoMatch.test.tsx`, `JunoRules.test.tsx`, `layout.test.tsx`

**Interfaces:**
- Consumes: Task 1 `JUNO_MAX_PLAYERS`, `JUNO_BASE_XP`.
- Produces: `junoSeats` returns 6 slots (`topLeft/topRight` extra); arena renders all 6; lobby/tile use max 6; rules table renders shared base + bonus note via existing keys.

- [ ] **Step 1: Update failing tests** — 6-seat arrangements (viewer bottom, 5–6 opponents distributed top row double), lobby 6 empties, tile `max: 6`, rules table has 10/5 rows.
- [ ] **Step 2: Run** `pnpm --filter @veyvox/web test -- juno` — expect FAIL.
- [ ] **Step 3: Implement** seats + arena + CSS grid rows for extra seats + lobby/tile/rules changes (no literal UI strings; reuse catalogs).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(juno): six-seat web layout`.

### Task 4: Locales + docs + e2e hardening

**Files:**
- Modify: `packages/web/src/locales/en/voice.json`, `en/errors.json`, `pt/voice.json`, `pt/errors.json`, digit sweep `2–4→2–6` across all `voice.json`; `packages/server/src/utils/httpErrors.ts` (done in Task 2); `docs/systems/juno.md`; `packages/server/test/juno-e2e.test.ts` (add 6-player round test).

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: Copy says 2–6 / six seats; docs say 2–6, places 1–6, dynamic formula; e2e covers 6-player privacy + XP.

- [ ] **Step 1: Update e2e + i18n tests** — 6-player round test; terminology tests still pass.
- [ ] **Step 2: Run** `pnpm --filter @veyvox/server test -- juno-e2e` (or targeted) + `pnpm check:i18n` — expect PASS.
- [ ] **Step 3: Commit** `feat(juno): six-player copy, docs and e2e`.

### Task 5: Full verification

- [ ] **Step 1: Run** `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm -r test` (scoped to juno when full suite too heavy, but report scope).
- [ ] **Step 2: Fix** anything red (one pass, TDD).
- [ ] **Step 3: Final external review** via `review_final_gpt56` (non-trivial behavior/contract change), fix concrete findings, re-run affected checks.
