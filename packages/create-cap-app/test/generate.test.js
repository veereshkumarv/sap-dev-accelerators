/**
 * What: End-to-end tests of project generation (without npm install): file set, headers on every
 *     file, package.json/xs-security.json content, zero CAP policy findings, determinism,
 *     overwrite refusal, cleanup on failure and the CLI contract.
 * Why: Proves that what create-cap-app writes is complete, self-documenting and passes the policy
 *     gate - the core promise of the golden path.
 * If missing or unlinked: Generator regressions (missing files, headers or authorization) are only
 *     found when a team creates a new project.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_POLICY_DIR } from '@sapdx/policy';
import { lintProject } from '@sapdx/cap-policy-lint';
import { generate, runCli, TargetError } from '../src/index.js';
import { missingMarkers } from '../../../scripts/check-file-headers.js';

const MONOREPO = fileURLToPath(new URL('../../../', import.meta.url));
const base = { policyDir: BUNDLED_POLICY_DIR, skipInstall: true };

/** @param {string} root */
async function readTree(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  /** @type {Record<string, string>} */
  const files = {};
  for (const e of entries.filter((d) => d.isFile())) {
    const rel = path.relative(root, path.join(e.parentPath, e.name)).replaceAll('\\', '/');
    files[rel] = await readFile(path.join(root, rel), 'utf8');
  }
  return files;
}

const parent = await mkdtemp(path.join(tmpdir(), 'cap-gen-'));
const messages = /** @type {string[]} */ ([]);
const result = await generate({ ...base, name: 'sales-orders', dir: parent, sapdxSource: MONOREPO, log: (m) => messages.push(m) });
const tree = await readTree(result.root);

test('generates the complete golden-path file set', () => {
  assert.deepEqual(Object.keys(tree).sort(), [
    '.github/workflows/ci.yml',
    '.gitignore',
    '.npmrc',
    '.vscode/extensions.json',
    '.vscode/launch.json',
    '.vscode/settings.json',
    '.vscode/tasks.json',
    'README.md',
    'catalog-info.yaml',
    'db/schema.cds',
    'docs/adr/0001-record-architecture-decisions.md',
    'docs/api.md',
    'docs/architecture.md',
    'docs/files.md',
    'eslint.config.mjs',
    'mta.yaml',
    'package.json',
    'server.js',
    'srv/sales-orders-service.cds',
    'srv/sales-orders-service.js',
    'test/operations.test.js',
    'test/sales-orders-service.test.js',
    'xs-security.json',
  ]);
  assert.deepEqual(result.files, Object.keys(tree).sort());
  assert.deepEqual(messages, ['cds init sales-orders --add nodejs,hana,xsuaa,mta,destination,application-logging,lint,sqlite', 'cds compile srv --to xsuaa']);
});

test('every file carries the What / Why / If-missing header, except the documented XSUAA descriptor', () => {
  for (const [file, text] of Object.entries(tree)) {
    if (file === 'xs-security.json') continue;
    assert.deepEqual(missingMarkers(file, text), [], file);
  }
  assert.match(tree['docs/files.md'], /`xs-security\.json`[\s\S]*No inline header/);
  assert.doesNotMatch(tree['srv/sales-orders-service.js'], /\{\{|\}\}/, 'no unrendered placeholders');
});

test('package.json carries scripts, test tooling, policy tooling, Node 24 and mocked users', () => {
  const pkg = JSON.parse(tree['package.json']);
  assert.equal(pkg.name, '@acme/sales-orders');
  assert.deepEqual(pkg.engines, { node: '^24' });
  for (const script of ['start', 'watch', 'lint', 'test', 'policy', 'policy:sarif', 'check']) assert.ok(pkg.scripts[script], script);
  assert.match(pkg.scripts.test, /--test-coverage-lines=80/);
  assert.equal(pkg.devDependencies['@cap-js/cds-test'], '1.0.2');
  assert.match(pkg.devDependencies['@sapdx/cap-policy-lint'], /^file:.*packages\/cap-policy-lint$/);
  assert.deepEqual(pkg.cds.requires.auth.users.bob.roles, ['Viewer']);
  assert.equal(pkg.cds.requires['[production]'].auth, 'xsuaa');
});

test('xs-security.json contains the roles of the service model', () => {
  const xs = JSON.parse(tree['xs-security.json']);
  assert.deepEqual(xs['role-templates'].map((/** @type {any} */ r) => r.name).sort(), ['Admin', 'Viewer']);
  assert.deepEqual(xs.scopes.map((/** @type {any} */ s) => s.name).sort(), ['$XSAPPNAME.Admin', '$XSAPPNAME.Viewer']);
});

test('CI workflow keeps GitHub expressions and uses Node 24', () => {
  const ci = tree['.github/workflows/ci.yml'];
  assert.match(ci, /\$\{\{ github\.ref \}\}/);
  assert.match(ci, /node-version: 24/);
  assert.match(ci, /run: npm run policy:sarif/);
  assert.match(ci, /npx --no-install sapdx-gate/);
  assert.doesNotMatch(ci, /npx (cap-policy-lint|sapdx-gate)/, 'no registry fallback for our tools');
});

test('SAP readme is replaced by README.md (case-insensitive file systems)', async () => {
  const names = await readdir(result.root);
  assert.ok(names.includes('README.md'));
  assert.ok(!names.includes('readme.md'));
  assert.match(tree['README.md'], /# sales-orders/);
});

test('generated project passes the CAP policy gate with zero findings', async () => {
  const { findings, gate } = await lintProject(result.root, { policyDir: BUNDLED_POLICY_DIR });
  assert.deepEqual(findings, []);
  assert.equal(gate.passed, true);
});

test('generation is deterministic', async () => {
  const other = await mkdtemp(path.join(tmpdir(), 'cap-gen-again-'));
  const again = await generate({ ...base, name: 'sales-orders', dir: other, sapdxSource: MONOREPO });
  const tree2 = await readTree(again.root);
  for (const [file, text] of Object.entries(tree)) {
    // file: paths are relative to the project location and legitimately differ.
    if (file === 'package.json') continue;
    assert.equal(tree2[file], text, file);
  }
});

test('custom options flow into names, facets and registry versions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cap-gen-custom-'));
  const custom = await generate({ ...base, name: 'billing', dir, db: 'postgres', entity: 'Invoices', namespace: 'acme.billing' });
  const files = await readTree(custom.root);
  assert.ok(files['srv/billing-service.cds'].includes('service BillingService'));
  assert.ok(files['db/schema.cds'].includes('entity InvoiceItems'));
  assert.ok(files['mta.yaml'].includes('postgres'));
  assert.equal(JSON.parse(files['package.json']).devDependencies['@sapdx/policy'], '0.1.0');
});

test('refuses to overwrite a non-empty target and leaves it untouched', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cap-gen-exists-'));
  await mkdir(path.join(dir, 'sales-orders'));
  await writeFile(path.join(dir, 'sales-orders', 'keep.txt'), 'mine');
  await assert.rejects(generate({ ...base, name: 'sales-orders', dir }), TargetError);
  assert.equal(await readFile(path.join(dir, 'sales-orders', 'keep.txt'), 'utf8'), 'mine');
  // An existing but empty folder is fine.
  await mkdir(path.join(dir, 'empty-one'));
  await generate({ ...base, name: 'empty-one', dir });
});

test('removes the half-generated project when generation fails', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cap-gen-fail-'));
  await assert.rejects(generate({ ...base, name: 'broken', dir, sapdxSource: path.join(dir, 'no-such-repo') }), /ENOENT/);
  assert.deepEqual(await readdir(dir), []);
});

test('CLI: help, usage errors, success and target conflicts', async () => {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const io = { stdout: (/** @type {string} */ s) => out.push(s), stderr: (/** @type {string} */ s) => err.push(s) };
  assert.equal(await runCli(['--help'], io), 0);
  assert.match(out.join('\n'), /^Usage: create-cap-app/);
  assert.equal(await runCli([], io), 2);
  assert.equal(await runCli(['a', 'b'], io), 2);
  assert.equal(await runCli(['--nope'], io), 2);
  assert.equal(await runCli(['Bad_Name', '--policy', BUNDLED_POLICY_DIR], io), 2);
  assert.match(err.join('\n'), /kebab-case/);

  const dir = await mkdtemp(path.join(tmpdir(), 'cap-gen-cli-'));
  out.length = 0;
  assert.equal(await runCli(['orders', '--dir', dir, '--skip-install', '--policy', BUNDLED_POLICY_DIR], io), 0);
  assert.match(out.join('\n'), /Created .*orders \(23 files\)/);
  assert.equal(await runCli(['orders', '--dir', dir, '--skip-install', '--policy', BUNDLED_POLICY_DIR], io), 2);
  assert.equal(await runCli(['other', '--dir', dir, '--skip-install', '--policy', BUNDLED_POLICY_DIR, '--sapdx-source', '/no/such/repo'], io), 1);
});
