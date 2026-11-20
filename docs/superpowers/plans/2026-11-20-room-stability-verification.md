# Room stability: implementation evidence

Branch `fix/room-stability`; local only, with no change to VM, instance
limits, native capture authorization or production deployment.

| Area | Evidence | Pending |
| --- | --- | --- |
| Juno reads | Fake-clock regression covers 30-second passive and 5-second active recovery, fresh reads, visibility, logout, reconnect support and cooldown. The test fixture preserves consecutive cues for a passive listener and a minimized seated player. | Ten people on one HTTP source IP, 60 accepted table actions/minute for ten minutes, concurrent cue checks. Invalidation reads remain immediate; a shared NAT can still hit the cap when all clients need a snapshot for each move. |
| Juno art | The real local four-player preview requested nine compact cards at desktop DPR 1. The same URLs mapped to 971,066 bytes with originals versus 381,502 bytes with compact variants and unchanged background/decoration (61% reduction). At 390 CSS px/DPR 3 the tested hand selected compact cards; at desktop DPR 4 it selected originals. The compact sizes/hashes and all 59 corresponding originals are verified in `dist`. | Additional physical-device and zoom comparisons. |
| Automatic screen share | Default target 1080p60, H.264 in Auto. The Portuguese workbench showed 1080p, 60 and `Codec recomendado: H264` after selecting the preset. Manual codec, audio, SDR, saved preferences and host override precedence are preserved. H.264 has its own ceiling, including on manual HEVC viewer regression. | Confirmed HEVC-only first-publish failure/fallback and received-quality benchmark. No HEVC-first Automatic rollout. |
| Force SDR | Tested the terminal UI instruction to reselect the source while retaining Force SDR. No raw HDR fallback or new authorization path. | Native recovery, specifically the same whole-monitor failure in *The Last of Us Part II* or an evidenced equivalent. |
| Room quality | Local component, asset and stream-option tests only. | The healthy-link hour with ten people, two fully subscribed 1080p60 streams and Juno; separate degraded-link run. |

The synthetic codec probe encoded 24 frames of mixed text and motion at
1920×1080 with 60 FPS timestamps. VP9 and H.265 configured at 8 Mb/s and
H.264 at 10 Mb/s all emitted 24 chunks; it was not paced as a live stream,
and neither delivered FPS nor visual quality was measured. The existing
VP9/H.265 recommendations were not lowered on that basis.

461 focused Web tests, 16 Server Juno route/integration tests and 47 Desktop
SDR tests passed.
`pnpm build`, `pnpm typecheck`, `pnpm check:i18n`, desktop TypeScript build,
`pnpm lint`, and the PWA precache size gate passed. Vite Preview served all
118 original and compact WebPs with the expected MIME type and matching
hashes. A disposable local API answered `/api/health` and served the
compact card back from the production static route after the initial
dev run did not start. The x64 native addon and its C++ tests built and
passed on rerun; this does not establish packaged HDR capture behavior.
The recursive workspace test
stopped in unchanged desktop packaging/globbing and user-data migration
test files due to timeouts; all 27 tests in those two files passed in
isolation. The full Web run passed 4,314 of 4,319 tests, with five failures
in the language lifecycle/layout and Juno rules/settings files. All 85 tests
in those four files passed in an isolated rerun.

The second external review confirmed the independent H.264/VP8 backup
ceilings and found a host codec selection edge case. The last local fix
filters host candidates before requesting publication, rejects an HEVC-only
list in Auto, and recomputes the H.264 ceiling when the publisher cannot
use VP9. The two regressions failed before this change and passed afterward;
the final guard was not sent for a third external review.
