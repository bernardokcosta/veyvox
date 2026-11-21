# Juno Duo Seats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the teammate’s read-only cards at their own seat and keep the full team label visible with long player names.

**Architecture:** Keep the current relative seat order and server projection. In the teammate’s seat, replace the decorative backs with a horizontal row of upright card faces. Keep the team label outside the name’s truncation box.

**Tech Stack:** React, CSS container queries, Vitest, Chromium.

**Spec:** User-approved seat placement and team-label layout in the Juno 2v2 follow-up; game rules and wire data remain unchanged.

## Global Constraints

- Use the existing `JunoView.teams` and `JunoView.partnerHand`; do not derive private cards from any other data.
- Keep the local hand playable, the partner hand read-only, and opponents’ cards face down.
- Reuse existing translations and card art.

## Review Focus

- Both lateral positions can contain the partner; a departed partner and spectator must show no partner faces.
- Large hands should scroll within the seat instead of widening the arena.
- Long names must not clip the team labels in tall or short layouts.
- The report hammer, pile controls, and local hand remain accessible.

### Task 1: Move the partner hand into the seat

**Files:** `JunoMatch.test.tsx`, `JunoMatch.tsx`, `JunoPlayerBadge.tsx`, and `juno.css` under `packages/web/src/components/games/`; `docs/systems/juno.md`.

- [x] Pin left/right placement, no duplicate backs, no play controls, and no reveal for a spectator or absent partner in `JunoMatch.test.tsx`. Assert the full team label sits outside the truncating name element.
- [x] Run the focused Vitest file and confirm the placement regression fails.
- [x] Render the accessible partner hand only under the matching seat, using `JunoCard`; keep the existing opponent backs as the fallback. Separate the badge’s team chip from the name and adapt the seat row to compact containers.
- [x] Check a 2v2 fixture in Chromium for labels, hit areas, and scrolling at desktop, narrow and short sizes.
- [x] Run the complete web and server suites.
- [x] Update the Juno subsystem description.

The follow-up also resolves findings from the already-requested review of the
base duos mode: old-host lobby compatibility, atomic options rejection, frozen
seat-order validation before XP writes, team places in practice, no personal
victory for abandoned players, and duo-specific scoring copy.
