#!/usr/bin/env node
/**
 * Set the version in every package.json this repo releases in lockstep.
 *
 * The repo has always moved all of these together, and doing it by hand is what
 * let routes/instance.ts drift to a stale constant across two releases. This
 * script is the supported way to bump. Two things back it up: the server reads
 * its own version from its package.json rather than holding a copy, and
 * test/version-consistency.test.ts fails if the manifests disagree.
 *
 * Usage: node scripts/bump-version.mjs 1.0.3
 */
import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that hold workspace packages, relative to the repo root. */
const PACKAGE_PARENTS = ['packages', 'scripts'];

/**
 * Find every package.json that carries the release version.
 *
 * Discovered rather than hand-listed on purpose. A hardcoded list is one more
 * copy to drift, and drift is the whole reason this script exists: add a
 * workspace package and it is covered here and by the consistency test without
 * anyone remembering to update either.
 */
export function findVersionedManifests(root = REPO_ROOT) {
  const found = ['package.json'];

  for (const parent of PACKAGE_PARENTS) {
    const parentDir = path.join(root, parent);
    if (!existsSync(parentDir)) continue;

    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      // Return repository-relative paths with one spelling on every host.
      // path.join(root, relative) below still resolves these on Windows.
      const relative = path.posix.join(parent, entry.name, 'package.json');
      if (existsSync(path.join(root, relative))) found.push(relative);
    }
  }

  return found.sort();
}

/** Accepts a plain semver release. Prereleases and build metadata are not used here. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Updates the Rust sources of truth for the Android client alongside the
 * package.json manifests: `packages/mobile/Cargo.toml` (`[package]`
 * version, read by `mobile check` and baked into the APK versionName) and
 * the `veyvox-mobile` stanza of `packages/mobile/Cargo.lock` (committed
 * for reproducible APK builds). Line endings of each file are preserved
 * (a CRLF checkout must not poison the next bump). Returns the pending
 * writes without touching disk; `main` validates everything first and
 * only then writes, so a failure can never leave manifests diverged.
 */
export async function updateRustVersion(root, next) {
  const pending = [];
  const cargo = path.join(root, 'packages/mobile/Cargo.toml');
  const raw = await readFile(cargo, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const updated = raw
    .split(/\r?\n/)
    .map((line) =>
      /^version\s*=\s*"[^"]*"$/.test(line) ? `version = "${next}"` : line,
    )
    .join(eol);
  if (updated === raw) throw new Error('No [package] version found in packages/mobile/Cargo.toml');
  pending.push([cargo, updated]);

  const lock = path.join(root, 'packages/mobile/Cargo.lock');
  let lockRaw;
  try {
    lockRaw = await readFile(lock, 'utf8');
  } catch {
    throw new Error('packages/mobile/Cargo.lock is missing; generate it with `cargo test -p veyvox-mobile` and commit it');
  }
  const lockEol = lockRaw.includes('\r\n') ? '\r\n' : '\n';
  const lockLines = lockRaw.split(/\r?\n/);
  let lockUpdated = false;
  for (let i = 0; i + 2 < lockLines.length; i++) {
    if (
      lockLines[i] === '[[package]]' &&
      lockLines[i + 1] === 'name = "veyvox-mobile"' &&
      /^version = "[^"]*"$/.test(lockLines[i + 2])
    ) {
      lockLines[i + 2] = `version = "${next}"`;
      lockUpdated = true;
      break;
    }
  }
  if (!lockUpdated) throw new Error('No veyvox-mobile stanza found in packages/mobile/Cargo.lock');
  pending.push([lock, lockLines.join(lockEol)]);
  return pending;
}

async function main() {
  const next = process.argv[2];

  if (!next) {
    console.error('Usage: node scripts/bump-version.mjs <version>');
    process.exit(1);
  }

  if (!VERSION_PATTERN.test(next)) {
    console.error(`Not a release version: ${next}. Expected three dot-separated numbers, for example 1.0.3.`);
    process.exit(1);
  }

  const manifests = findVersionedManifests();
  const pending = [];

  for (const relative of manifests) {
    const file = path.join(REPO_ROOT, relative);
    const raw = await readFile(file, 'utf8');

    // Rewrite the version line in place rather than reserialising the parsed
    // object. JSON.stringify would drop the file's existing indentation and
    // trailing newline, producing a diff that touches every line of every
    // manifest for a one-word change.
    const updated = raw.replace(
      /^(\s*"version"\s*:\s*)"[^"]*"/m,
      (_match, prefix) => `${prefix}"${next}"`,
    );

    if (updated === raw) {
      console.error(`No version field found in ${relative}. Nothing further was written.`);
      process.exit(1);
    }

    pending.push([file, updated, relative]);
  }

  for (const [file, updated] of await updateRustVersion(REPO_ROOT, next)) {
    pending.push([file, updated, path.relative(REPO_ROOT, file).split(path.sep).join('/')]);
  }

  // Validate-everything-first: every write below is already computed, so a
  // failure above leaves the tree untouched instead of half-bumped.
  const written = [];
  for (const [file, updated, relative] of pending) {
    await writeFile(file, updated);
    written.push(relative);
  }

  console.log(`Set version ${next} in:`);
  for (const relative of written) console.log(`  ${relative}`);
  console.log('\nNext: commit as chore/release-<version>, then tag and push.');
}

// Only run when invoked directly, so the consistency test can import the finder.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
