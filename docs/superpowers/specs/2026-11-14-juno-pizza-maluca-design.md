# Design: Juno Pizza Maluca

## Status and objective

**2026-11-16 correction:** The user clarified that the zero-inclusive selection
below was incorrect. The current rule rolls 1–5 with equal probability before
clamping to leave one original card, and gives each removed card an independent,
equally likely other-player recipient. The user further requested synchronized
visible hand departures/arrivals, a playable development preview and textured
edge flour capped at 50%, explicitly rejecting a flat white wash.
See [the correction plan](../plans/2026-11-16-juno-pizza-correction.md) and
[`docs/systems/juno.md`](../../systems/juno.md) for the current contract; the
zero-inclusive passages below record the superseded initial design.

Approved by the user on 2026-11-14, including the summarized defaults:
one copy, retaining the active color, ordinary last-card victory without an
exchange, and flour identity through the whole round. The user selected
integration into the existing engine, audio and effects, with a roughly
five-second server-synchronized resolution.
This document is not authorization to publish, deploy or change production.

Add the supplied Pizza Maluca special card to the native 2–4-player Juno game.
It plays over any color/number, redistributes a random bounded selection of cards
between players, and presents a small spinning pizza with satisfying, restrained
card flights and flour impacts. The server determines every actual exchange.
Flour becomes a persistent visual identity of each transferred card, including
when that card is eventually played onto the discard pile.

## Confirmed requirements and approved defaults

Confirmed by the user:

- Reuse the current authoritative game, private transport, effects and audio.
- Every player's hand, including the author's, participates. Each can send 0–5
  randomly chosen cards to other players; separate cards may have different
  recipients. Never empty a hand through redistribution.
- The pizza is approximately one third of a card's height, spins on its own axis
  and visits every occupied hand, with 2, 3 or 4 players.
- Animate actual transfers with attractive but restrained effects, not a huge
  pizza or excessive visual noise.
- Flour follows the affected card through subsequent moves and remains visible
  on that card when played. The overlay shares the card's exact geometry.
- Use the supplied artwork/audio as the pt-BR media edition only. Do not invent
  translated artwork or dubbing. Existing localized interface text is separate.
- Resolve the effect over approximately five seconds, then release the next turn.

Builder defaults approved with this document:

- Add exactly one Pizza Maluca to capable rounds: 111 cards with memory and
  Entorpecido. Keep the existing 108/109/110-card compatibility cohorts.
- Like the other colorless rare cards, retain the active color, require no color
  selection, and never use Pizza Maluca as the initial numeric discard.
- The no-zero rule governs the exchange. Playing Pizza Maluca as an ordinary
  last card still wins immediately, like the existing rare cards; in that case
  there is no redistribution or five-second pause. Existing result audio wins.
- The flour identity lasts for the whole round, including discard recycling and
  later transfers. A new round creates clean card instances.
- Reaching one card solely through redistribution does not create a missed-JUNO
  offense. Normal deliberate play-down-to-one rules remain applicable.

## Approach and alternatives

Selected direction: extend the existing synchronous engine and Juno-only
contract, attach flour to card instances, and render bounded cosmetic flights
from the server's public transfer summary. The existing room sweep owns the
resolution deadline; the current session owns audio. No new service, dependency,
database table, voice publication or global animation/capability framework.

An instant exchange with overlapping cosmetic flights is simpler, but permits
subsequent moves to obscure the effect. The user selected a synchronized pause
instead. A client-decided exchange would disagree between viewers and enable
cheating; a temporary flour animation would lose the required card identity.
Those alternatives do not satisfy the confirmed requirements.

## Server-owned exchange

1. Apply existing authentication, membership, capability, revision, ownership,
   turn and drawn-card checks before any effect RNG. Resolve an existing memory
   or intoxication condition through the same normal engine path.
2. On a successful pizza play, remove it to the discard and retain the active
   color. An intoxicated failed attempt does not activate pizza or mark cards.
   An ordinary last-card victory follows the approved exception above.
3. Snapshot all remaining hands before selecting transfers. For a hand of N
   cards, uniformly sample a count from 0 through min(5, N - 1), inclusive.
   Select that many distinct cards uniformly without replacement. A one-card
   hand necessarily sends zero; the server never removes its final card.
4. Independently choose each selected card's recipient uniformly among the
   other seated players. Never send a card to its current owner. Cards from one
   source may split between recipients. Counts need not be equal or balanced.
5. Remove the selections from their original hands, then distribute them once.
   Incoming cards are not selected again during the same activation. Mark each
   transferred card as flour-covered, idempotently. Preserve instance IDs and
   conserve every card across hands, draw pile and discard.
6. Commit the resulting hands and a bounded public source/destination/quantity
   summary atomically. Maximum transfer count is 20, not an unbounded shuffle.
   A valid all-zero exchange is allowed and still plays the pizza effect.
7. Advance normally in the current direction and establish the resolution pause.
   Do not change direction, choose a new color, stack penalties or award XP.

Use the existing crypto RNG. There is no balancing, hand-strength weighting,
forced positive transfer, client seed or client-selected recipient.

## Resolution, lifecycle and JUNO

- Use a Juno-local 5,000ms resolution deadline and the existing room sweep/read/
  command lifecycle. No acknowledgment or new timer loop is required. The server
  publishes a relative remaining duration, not a client-trusted finish time.
- During resolution, reject play/draw/pass/announce/report without modifying
  state or consuming effect RNG. Leave and authoritative presence cleanup still
  work. A stale command still fails the ordinary revision check.
- At the deadline, controls unlock without requiring every client to finish
  rendering. The next player has a full 45-second turn after the pause. Computers
  start their existing decision pacing after the pause, not during it.
- Freeze still-valid report windows during the pause, preserving their time
  remaining at activation. Do not revive already expired windows. The client
  also freezes their countdown, rather than subtracting wall time twice.
- Gaining transferred cards clears the recipient's announcement and report
  opportunity, as ordinary drawing does. Sending cards clears stale announcement
  state when the resulting hand is not one. Transfers alone never create a new
  report window. Unchanged valid one-card opportunities remain intact.
- A pizza played deliberately from two cards to one follows the existing JUNO
  call/report rule only if the author finishes the exchange with one card and
  did not gain cards. Its report deadline starts after resolution. There is no
  penalty opportunity if redistribution itself reduced a larger hand to one.
- A departure cancels remaining travel and the pause, retaining already committed
  transfers/flour. Preserve the existing removal, host succession, turn and
  below-two-player result rules. A surviving next turn gets its full deadline;
  report windows retain only the pause time actually elapsed.
- Round finish, expiry or disposal clears resolution state. Scope/access loss
  cancels client animations/audio and private snapshots through existing owners.
  No effect can delay settlement, recreate a removed player or reopen a result.

## Contract, privacy and compatibility

Extend only the existing Juno HTTP snapshot/command capability negotiation.
Reuse `juno_updated` as a non-secret invalidation, not a card-data broadcast.

- Add a Juno-local `pizza=1` query capability, requiring the current `memory=1`
  and `intoxicated=1` declarations. Accept only exact supported values, and reject
  duplicate/unknown query keys consistently with the current route contract.
- Add optional root `supportsPizza` and per-game `pizzaEnabled`. Record lobby
  declarations for seated humans and freeze support at start, as for existing
  rare cards. Computers support it internally. Later spectators or declarations
  cannot alter a running deck. Rematch resets declarations normally.
- Unsupported viewers of a pizza-enabled round get the existing coded
  `juno_update_required` refusal with no private view; existing leave stays
  possible. Preserve authentication/voice/permission gates and rate budgets.
- On old hosts, a read-only capability probe may fall back from the full query
  to intoxicated support, then memory-only, only on exact 400 `invalid_body` and
  within the same account/session generation. Bound this to two fallback reads.
  Subsequent reads and commands use confirmed support. Never replay a mutation.
- Extend `JunoCard` with an optional flour marker. Only the viewer's own cards
  and already public played/discarded cards carry that per-instance marker in
  the view. Preserve it in copied public play feedback, not only in the hand.
- Extend the confirmed pizza move with source/destination/amount summaries only,
  and expose an optional active resolution `{ id, remainingMs }`. Reuse its stable
  move ID to suppress duplicate audio/animation. Do not serialize transferred
  card IDs, faces, colors, hand indices or draw order in the public summary.
- If opponents' backs show flour, expose only an aggregate flour-covered count
  per player, never opponent card IDs or a hidden-slot-to-card mapping. Existing
  capped fans are a representative count, not a reconstruction of private hands.
- A memory-masked viewer still receives only opaque owned slots and no fronts,
  color, legal hints or private flour pattern. Spectators have no private hand.
  Preserve private intoxicated-miss projection and all store race protections.

## Visual treatment and audio

- Reuse the real match layout and its size/interface-scale-aware coordinates.
  Start near the author and visit occupied hand centers in current play order,
  skipping empty seats. Use the actual local hand, not merely its avatar, as the
  bottom anchor. Recompute/cancel safely on resize or missing/changed anchors;
  never fly toward an old screen coordinate after a layout change.
- Size the round pizza sprite to about one third of the actual local card's
  rendered height, falling back to the discard card when spectating. Keep the
  sprite circular and the path smooth; separate its rotation from translation.
- Stage source pickups and destination arrivals inside the five seconds from the
  confirmed transfer summary. Use existing card-back artwork for public flight
  ghosts so another hand is never revealed. Do not fabricate flights for zero
  transfers. Update authoritative hands once; cosmetic ghosts cannot be played.
- Use restrained easing, small card tilts, a light fading flour trail and brief
  impacts. Bound live ghost/particle counts, release nodes/animation handles and
  keep the whole effect pointer-transparent. Do not shake or reflow the table.
- Flour and front share one 720:1056 card wrapper, rounded clipping, transforms,
  scaling and perspective. Overlay is absolute inset-zero and pointer-transparent,
  not an independently positioned image or pre-baked duplicate of every front.
  Keep numbers/symbols readable and the flour noticeable at real table sizes.
- Render flour consistently in the own hand, flight feedback, new discard play
  and persistent top card. Later moves/polls do not clear it. Do not cover all
  cards merely because one player participated: only transferred instances gain
  the marker, and already-marked instances retain it.
- Reduced motion retains final hands, permanent flour and static localized
  resolution feedback without travel, spin, pulsing or particle bursts. The
  authoritative pause is identical for all viewers regardless of motion settings.
- Reuse the once-owned `JunoSounds`/AudioManager path and actual `JUNO_DUBBINGS`
  pt-BR edition. Play the supplied cue once on a new confirmed activation, for
  following players/spectators, with existing effects volume/output/deafen gates.
  Do not synthesize speech, layer a second activation cue or publish to LiveKit.
- Initial mount, reconnect, polling and reopening the table never replay history,
  even during an active resolution. Reopening shows final hands and the remaining
  disabled interval. Audio/decode failure never changes or blocks game state.

## Assets and evidence

Source directory: `C:\Users\berna\Downloads\Nova pasta (2)`.
Use supplied media, without generating replacements or inferring a license.

| Source | Inspected facts / SHA-256 |
| --- | --- |
| `Pizza Maluca Cósmica.png` | 1060×1484 RGB; `6f80604b0ae2490fcc4ba079a91003fcf017fee221f721c4e816851d70fc68f4` |
| `artes/pizza_isolada_512.png` | 512×512 RGBA; `fbc9978847740e6fa263fb716c3293e08bc7ea34b0891cfe83dfb0aa9c066eb9` |
| `artes/overlay_farinha_720x1056.png` | 720×1056 RGBA; `a36c25b5ff38c03b0c0271b56803790e3118a4f1d44be772faa2155281d6d6ce` |
| `artes/particula_farinha.png` | 128×128 RGBA; `32ac287c14ba24705bcec7e5796a2cbf7abbd11f736a6ac72cf9a6f238a17fb9` |
| `animacoes/impacto_farinha_1x.webp` | 52,964 bytes; `d64ff0f92fcf158b73095617d59c881d8c9dd421a7f3e0f51d88b0f0d49e3a4f` |
| `hf_20261114_204721_75c2b04e-370d-40b3-bf65-d5dc26f49edc.wav` | PCM 16-bit stereo 24kHz, about 2.2053s; `d52f43f3cfa6e12ecb96c5ee9a66d0554284b25efa455fcf16fa2094d2f5cb14` |

Card art must be normalized to the existing 720×1056 card geometry, preserving
the supplied content and documenting any outer-canvas crop/mask. Preserve alpha
for pizza/flour/particles. Convert the complete WAV to existing Ogg Vorbis cues
without content edits or normalization. Record source and derived hashes/crops
in the existing Juno manifest/README during implementation.

The supplied instructions and still images have been read; PNG/WAV headers and
the hashes above have been checked directly. The MP4 is a reference, not a
sprite; its temporal motion and the audio's spoken content have not yet been
independently reviewed. No video playback, listening, conversion or running-game
acceptance is claimed by this design-only change.

## Structure, style and boundaries

Existing stack: strict TypeScript, React 19, Fastify 5, Zustand, existing scoped
CSS, i18next catalogs and Vitest. No new dependency is required by this design.

- Contract: `packages/shared/src/juno.ts`.
- Authority: `packages/server/src/games/juno.ts`, `junoBot.ts`, their colocated
  tests, and `packages/server/src/routes/juno.ts` with route tests.
- Client: `packages/web/src/api/client.ts`, `stores/junoStore.ts`, and existing
  `components/games/` cards, match/effects/audio/assets/rules and their tests.
  A focused Juno-only helper/component is acceptable if needed, not a parallel
  game engine or a global subsystem.
- Assets: `packages/web/public/games/juno/` and `public/sounds/`.
- Localization: relevant `packages/web/src/locales/*/voice.json` entries in all
  25 released UI languages, including name/rules/accessible flour/resolution
  feedback; media editions remain pt-BR only. Reuse existing coded errors.
- During implementation update `docs/systems/juno.md`, `sounds.md`,
  `localization.md` and `api.md` where their contracts change.

Follow existing named types, single-quoted strings and explicit unions, e.g.
`{ type: 'play', cardId: card.id, announce: sayJuno }` through the existing
command path. No `any`, TODO implementation, client-supplied identity or RNG.

Always preserve native identity, private projection, permissions, practice/XP,
conservation, retry/rate-limit protections and existing rare-card behavior.
Ask first for dependencies, schema/CI changes, publication or deployment.
Never touch production/runtime `data/`, credentials, unrelated work or tags.

## Verification and success criteria

Implementation must include focused deterministic Vitest coverage:

- Engine: 108/109/110/111 cohorts, exactly one pizza, retained color, legal
  arbitrary-face play, two/three/four players, both directions, zero/five
  boundaries, one-card protection, distinct selection, split recipients,
  simultaneous non-cascading transfers, all-zero result and card conservation.
- Persistent identity: flour only on transferred cards; retained through further
  turns, transfers, play feedback, discard, recycle and return to a hand; clean
  new rounds. No duplicate or missing IDs.
- Rule interactions: JUNO call/report rules above, frozen deadlines, exact pause
  boundary, no RNG on invalid/stale/duplicate requests, full next-turn timer,
  existing draw restriction, memory success and intoxicated miss, bot pacing,
  last-card pizza victory, departures, expiration and unchanged XP settlement.
- Transport/privacy: no opponent face/ID/slot leaks, spectator/masked projections,
  auth/capability gates, legacy/mixed negotiation, bounded read fallback without
  mutation retries, same-session guards and unchanged rate budgets.
- UI/store/audio: persistent aligned flour in hand/discard, disabled interval,
  zero-count flights, correct seat anchors, once-only effects/sound, reduced
  motion, stale response/scope cleanup, deafen/volume and failed asset loads.

Implementation commands (not evidence that they have run during design):

```bash
pnpm --filter @veyvox/server test -- src/games/junoPizza.test.ts
pnpm --filter @veyvox/server test -- src/games/junoMemory.test.ts src/games/junoIntoxicated.test.ts src/games/junoReports.test.ts src/routes/juno.test.ts
pnpm --filter @veyvox/web test -- src/components/games src/stores/junoStore.test.ts
pnpm check:i18n
pnpm typecheck
pnpm --filter @veyvox/server typecheck:e2e
pnpm --filter @veyvox/desktop build:ts
pnpm build
pnpm lint
pnpm dev:server
pnpm dev:web
```

Keep `pnpm build` in its fixed shared → server → web order. Use isolated test
storage and established runners. Run the real table in desktop, short/scaled and
mobile containers, with screenshots/recordings for 2–4 seats and hand→flight→
discard flour alignment. Verify actual decode/output and compare the supplied
motion reference when supported; distinguish fixture tests from a live
multi-device call. Complete external final review of the whole implementation.

## Next gate

This design and native execution of the linked implementation plan were approved.
Implementation/validation evidence is recorded in
`docs/superpowers/plans/2026-11-14-juno-pizza-maluca.md`.
There are no other product questions intentionally left open; precise easing,
bounded particle density and internal helper names are implementation choices
subject to the stated visual, privacy and lifecycle acceptance criteria.

## Additional approved UI cleanup

In the same approval message the user requested removal of the highlighted
description below the game tiles in the Games picker: the paragraph currently
rendered from `voice:juno.description` in `GamesPicker.tsx`. Remove only that
bottom paragraph, not the header prompt, tiles/actions, or the lobby's separate
screen-reader description. Keep the shared catalog entry because the lobby
still uses it. This local presentation cleanup requires no new mechanism.
