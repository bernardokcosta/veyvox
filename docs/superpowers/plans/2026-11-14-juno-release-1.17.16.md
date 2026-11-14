# Juno publication: Veyvox 1.17.16

The user explicitly authorized making all tests pass, committing, pushing and
publishing release 1.17.16 after the approved Pizza Maluca implementation.
Continue native execution. No production deployment or weakening of security,
tests, branch rules or release gates is authorized.

## Cause of the outstanding desktop test

Before installation, the committed manifest/lockfile required minimatch 11.0.5
but actual electron-builder/asar/glob consumers resolved local 11.0.4. The latter
truncated preprocessing to four patterns instead of throwing the fail-closed
RangeError asserted by the existing regression test. Synchronize the local
installation with `pnpm install --frozen-lockfile --ignore-scripts`; do not
remove the assertion, change its expected behavior or lower the declared floor.

## Publication checklist

- [x] Synchronize locked dependencies and rerun the unchanged failing desktop
  security regression, confirming actual consumer versions and no lockfile drift.
- [x] Use `node scripts/bump-version.mjs 1.17.16` for all release manifests and
  add `.github/release-notes/v1.17.16.md` without inventing release artifacts.
- [x] Run the complete workspace tests and tooling, sequential production build,
  lint/i18n/type checks and repository CI preflight checks using isolated test
  state. Preserve the earlier visual evidence; no live-call claim is added.
- [x] Obtain one final `review_final_gpt56` review of the full uncommitted
  implementation plus publication changes before committing/pushing.
- [ ] Commit only task-owned changes, push the feature branch, create a release
  PR to protected `master`, await checks and merge normally without bypasses.
- [ ] Wait for successful main-branch CI at the exact merged commit. Create and
  push the new immutable `v1.17.16` tag once, never move an existing tag.
- [ ] Let existing tag workflows publish the validated desktop inventory and
  container image. Verify the public release, tag/commit and expected assets;
  report any pending/failing platform job rather than claiming publication.

## Boundaries

The current feature branch starts at `e1b910f4` (`v1.17.15`), equal to
`origin/master` when inspected. Existing Pizza Maluca changes and their two
design/implementation documents belong to this same task and are included.
No dependency upgrades are planned: the install restores the already committed
lockfile. Do not rewrite historical Flatpak source pairs, alter production
runtime `data/`, publish a partial manual GitHub release, force-push, disable
required checks, or deploy/restart the hosted instance.

## Validation evidence

- Frozen installation completed without changing `pnpm-lock.yaml`; actual
  builder/asar/glob consumers now all resolve minimatch 11.0.5. The unchanged
  packaging-dependency suite passes all 12 tests, including the previously
  failing fail-closed assertion. No test or production security guard was weakened.
- Version bump changed exactly five package version lines to 1.17.16.
- Tooling suite: 185/185 pass. Lint, sequential root build, desktop TypeScript,
  server e2e TypeScript, precache budget and Flatpak Node SDK checks pass.
- Main branch uses repository rulesets (not classic branch protection). A PR
  with required CI/security/CodeQL checks is mandatory; auto-merge is disabled.
  Merge normally after checks rather than enabling settings or using admin bypass.
- Complete post-install workspace test run exits 0: desktop 37 files / 623 pass
  (18 existing skips), server 209 files / 2,368 pass, web 432 files / 4,279 pass.
  Total: 7,270 passing workspace tests, plus 185 passing tooling tests.
- Root typecheck/i18n passes after the locked install and version bump.
- Standalone artifact validation initially found obsolete generated server JS
  left by earlier checkouts, with no corresponding current source. The old
  `packages/server/dist` was preserved in an approved temporary backup outside
  the checkout, not deleted. Recompiling the current server produces a clean
  output; `node scripts/check-standalone.mjs --artifacts` now exits 0. No source
  inventory exception, retired implementation or runtime data was changed.
- Final external review approved all 77 modified/new files without actionable
  findings. Its independent checks passed 598 focused/tooling tests and 3,000
  real-crypto exchanges, plus lint/i18n/standalone/whitespace/media verification.
  Remote CI, native installer acceptance and publication gates remain mandatory.
