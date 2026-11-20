# Juno artwork provenance

Pizza Maluca artwork, pizza/flour/particle sprites, impact and WAV were supplied
and approved for source implementation on 2026-11-14. `cards/pizza.webp` maps the
complete 1060×1484 artwork to the existing 720×1056 geometry without padding and
uses the same radius-66 corner mask as other rare cards. The small pizza sprite
keeps its square proportions; flour/particle WebPs are lossless with alpha.
`ui/flour-impact.webp` keeps the supplied 16-frame animation byte-for-byte.
`/sounds/juno_pizza.ogg` is the complete approximately 2.2053-second stereo 24kHz
WAV encoded as Vorbis, without trimming, volume changes or normalization. All
source/output hashes, dimensions and sizes are in the manifest. Sources remain
untouched; no replacement artwork, extra dubbing edition or license claim is
inferred. The supplied MP4 was inspected through timestamp-spaced reference
frames, not shipped as a gameplay sprite. Spoken content was not transcribed.
The user separately authorized commit, push and release 1.17.16 after source
validation; this does not authorize deployment or imply additional media rights.

The Entorpecido card PNG and original WAV were supplied and authorized for
implementation in 1.17.13 on 2026-11-12. At the user's request,
`cards/intoxicated.webp` now crops the transparent outer canvas of the 1060×1484
original at (19,25), 1021×1427, normalizes the card frame to 720×1056 without
padding, and masks the rounded corners at radius 66 to match the existing memory
card. No replacement artwork was generated. `/sounds/juno_intoxicated.ogg` is
the complete 2.294542s stereo 24kHz clip encoded as Vorbis, without content edits
or volume normalization. Source/output hashes and sizes are in the manifest.
Original Downloads files are untouched. No authorship/license claim is inferred;
the clip's spoken content was not independently listened to or transcribed.

Supplied by the project user on 2026-11-05 in `juno-ui.zip` and
`Juno_Kit_Completo_108_Cartas.zip`. `manifest.json` records the source entry,
byte size and SHA-256 of every imported file, plus the archive fingerprints.
The project user explicitly authorized publication with release 1.16.3 on
2026-11-05. No additional license or authorship claim is inferred from the archives.

The 108-card logical deck uses 54 distinct original front artworks and one
original back. Byte-identical repeated card faces deliberately share an image,
not a runtime card id. Wire colors coral/amber/mint/sky map to red/yellow/green/
blue, and actions skip/reverse/draw2/wild/draw4 retain their existing rules.

The transparent `Animação de martelo de juiz neon.gif` was supplied separately
and approved for implementation/publication on 2026-11-06. `ui/hammer.gif` keeps
its exact nine-frame bytes; `ui/hammer-still.webp` is the tightly cropped first
frame for the resting report control. The manifest records source/crop/hashes.

Only separate approved WebP/SVG/GIF components were imported. Demo avatars, composed
previews, duplicate PNGs and the original archives are not shipped. Text, people,
interaction and rankings are actual application elements, not painted previews.

The memory-curse card and 2.79-second clip were supplied and approved for source
implementation/preview on 2026-11-07. `cards/memory.webp` crops the outer white
canvas at (80,76), 904×1326, scales to 720×1056 and masks the existing rounded
corners at radius 66. No replacement artwork was generated. The user's original
PNG and PCM WAV hashes, derived file hashes and crop are recorded in the manifest;
`memoryAudio` records the separately served `/sounds/juno_memory.ogg` (Ogg Vorbis).
Original source files remain untouched. No authorship/license claim or release/
deployment authorization is inferred from their provision.

`music/charting-the-dark.mp3` is the separate user-supplied background track
approved for the personal-settings source/preview phase. It is copied byte for
byte (4,363,065 bytes, approximately 181.52s); `manifest.music` records its source
name and matching SHA-256. The original Downloads file remains untouched. It is
streamed locally through the existing audio output rather than decoded into the
short-cue cache. No external service, authorship/license claim, offline-music
guarantee or release/deployment authorization is inferred.

The stacking scoreboard digits were supplied and approved for source
implementation on 2026-11-20 in `Imagem do ChatGPT 20 de nov. de 2026,
19_45_58-1.png` (1448×1086). `ui/stack-0.webp` through `ui/stack-9.webp`
plus `ui/stack-plus.webp` crop the exact 362×362 supplier grid (digits
row-major, `+` at column 2 row 2) without resampling or recoloring, preserving
the supplier alpha. The overlay composites them with `mix-blend-mode: screen`
so the neon glow reads on the cosmic table. Source/output
hashes, crops and sizes are in the manifest. The original Downloads file
remains untouched. No authorship/license claim is inferred.
