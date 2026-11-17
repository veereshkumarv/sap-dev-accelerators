#!/usr/bin/env node
/**
 * What: Guardrail run before the tests: every workspace package must have an entry point, test
 *     files and a coverage threshold.
 * Why: node --test on an empty package reports 0 tests and 100 % coverage - a false green this
 *     script turns into a failure.
 * If missing or unlinked: Unbuilt or untested packages pass npm test and CI, hiding missing tools
 *     behind a green pipeline.
 */
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootPkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

/** @type {string[]} */
const problems = [];
for (const pattern of rootPkg.workspaces) {
  const base = path.join(root, pattern.replace(/\/\*$/, ''));
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const main = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.'];
    if (!main || !(await exists(path.join(dir, main)))) problems.push(`${pkg.name}: entry point ${main ?? '(none)'} missing`);
    const tests = (await listFiles(path.join(dir, 'test'))).filter((f) => /\.test\.(c|m)?js$/.test(f));
    if (tests.length === 0) problems.push(`${pkg.name}: no test/*.test.js files`);
    if (!/--test-coverage-lines=\d+/.test(pkg.scripts?.test ?? '')) problems.push(`${pkg.name}: test script has no coverage threshold`);
  }
}

if (problems.length) {
  console.error(`Workspace guardrail failed:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('Workspace guardrail passed.');

/** @param {string} file */
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}
