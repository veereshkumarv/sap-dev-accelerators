/**
 * What: Unit tests for the generator building blocks: template renderer, option validation and
 *     naming, header formatting per file type, file catalog completeness.
 * Why: These pieces decide names, file contents and headers of every generated project; they must
 *     be proven independently of the slower end-to-end generation test.
 * If missing or unlinked: The package fails the workspace guardrail and regressions in naming,
 *     rendering or headers reach generated projects unnoticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_POLICY_DIR, loadPolicy } from '@sapdx/policy';
import { commentStyle, deriveNames, fileCatalog, OptionsError, render, RenderError, renderFilesDoc, withHeader } from '../src/index.js';
import { npm, run } from '../src/cds-dk.js';

const { naming } = await loadPolicy(BUNDLED_POLICY_DIR);
const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const entry = (/** @type {string} */ p, extra = {}) => ({ path: p, what: 'Does things.', why: 'Because.', missing: 'It breaks.', ...extra });

test('render substitutes placeholders, strips template comments, rejects unknown names', () => {
  assert.equal(render('{{! What: doc\nWhy: x }}\nA {{ a }}-{{b}}', { a: '1', b: '2' }), 'A 1-2');
  assert.throws(() => render('{{x}} {{y}}', {}, 't.cds'), (err) => err instanceof RenderError && /t\.cds: unknown placeholder\(s\) x, y/.test(err.message));
  // GitHub Actions expressions contain dots and must survive rendering untouched.
  assert.equal(render('${{ github.ref }} ${{ secrets.GITHUB_TOKEN }}', {}), '${{ github.ref }} ${{ secrets.GITHUB_TOKEN }}');
});

test('deriveNames applies defaults and derives policy-compliant names', () => {
  const n = deriveNames({ name: 'sales-orders' }, naming);
  assert.equal(n.service, 'SalesOrdersService');
  assert.equal(n.serviceFile, 'sales-orders-service');
  assert.equal(n.servicePath, 'sales-orders');
  assert.equal(n.entity, 'SalesOrders');
  assert.equal(n.itemEntity, 'SalesOrderItems');
  assert.equal(n.entityLabel, 'Sales Orders');
  assert.equal(n.npmName, '@acme/sales-orders');
  assert.deepEqual(n.facets, ['nodejs', 'hana', 'xsuaa', 'mta', 'destination', 'application-logging', 'lint', 'sqlite']);
  const svc = deriveNames({ name: 'billing-service', db: 'postgres', entity: 'Invoices', namespace: 'acme.billing' }, naming);
  assert.equal(svc.service, 'BillingService', 'no duplicated "Service" suffix');
  assert.equal(svc.serviceFile, 'billing-service');
  assert.equal(svc.facets[1], 'postgres');
});

test('deriveNames rejects invalid and unsupported options with all problems listed', () => {
  const err = (() => {
    try {
      deriveNames({ name: 'Bad_Name', tenancy: /** @type {any} */ ('x'), target: /** @type {any} */ ('x'), db: /** @type {any} */ ('x'), entity: 'order', namespace: 'my.app' }, naming);
    } catch (e) {
      return e;
    }
  })();
  assert.ok(err instanceof OptionsError);
  for (const expected of ['kebab-case', 'tenancy must be', 'target must be', 'db must be', 'plural PascalCase', 'naming policy']) {
    assert.match(err.message, new RegExp(expected));
  }
  assert.throws(() => deriveNames({ name: 'a', target: 'kyma' }, naming), /kyma is not supported yet/);
  assert.throws(() => deriveNames({ name: 'a', tenancy: 'multi' }, naming), /multi is not supported yet/);
  assert.throws(() => deriveNames({ name: 'a' }, { cap: { ...naming.cap, servicePattern: '^X$' } }), /Derived service name/);
});

test('commentStyle picks the right syntax per file type', () => {
  const cases = {
    'srv/x.js': 'block', 'eslint.config.mjs': 'block', 'db/schema.cds': 'slash', '.vscode/launch.json': 'slash',
    'package.json': 'json-key', 'mta.yaml': 'hash', '.github/workflows/ci.yml': 'hash', '.gitignore': 'hash',
    '.npmrc': 'hash', 'i18n/messages.properties': 'hash', 'README.md': 'html', 'xs-security.json': 'none', 'data.csv': 'none',
  };
  for (const [file, style] of Object.entries(cases)) assert.equal(commentStyle(file), style, file);
});

test('withHeader inserts headers in every syntax and keeps hashbangs first', () => {
  assert.match(withHeader(entry('a.js'), 'code();\n'), /^\/\*\*\n \* What: Does things\.\n \* Why: Because\.\n \* If missing or unlinked: It breaks\.\n \*\/\ncode/);
  assert.match(withHeader(entry('bin/x.js'), '#!/usr/bin/env node\ncode();\n'), /^#!\/usr\/bin\/env node\n\/\*\*/);
  assert.match(withHeader(entry('db/a.cds'), 'namespace x;'), /^\/\/ What: .*\n\/\/ Why: .*\n\/\/ If missing.*\nnamespace x;/);
  assert.match(withHeader(entry('mta.yaml'), 'ID: x\n'), /^# What: .*\n# Why: .*\n# If missing.*\n\nID: x/);
  assert.match(withHeader(entry('README.md'), '# T\n'), /^<!--\nWhat: .*\nWhy: .*\nIf missing.*\n-->\n\n# T/);
  const pkg = JSON.parse(withHeader(entry('package.json'), '{"//":"old","name":"x"}'));
  assert.deepEqual(Object.keys(pkg), ['//', 'name']);
  assert.match(pkg['//'][0], /^What: /);
  assert.equal(withHeader(entry('xs-security.json', { noInline: 'strict' }), '{}'), '{}');
  const long = withHeader(entry('a.js', { what: 'word '.repeat(40).trim() }), '');
  assert.ok(long.split('\n').every((l) => l.length <= 100), 'lines are wrapped');
});

test('renderFilesDoc lists files sorted and explains missing inline headers', () => {
  const doc = renderFilesDoc([entry('b.js'), entry('xs-security.json', { noInline: 'XSUAA is strict.' })], 'demo');
  assert.match(doc, /^# Files in demo/);
  assert.ok(doc.indexOf('`b.js`') < doc.indexOf('`xs-security.json`'));
  assert.match(doc, /\*\*No inline header:\*\* XSUAA is strict\./);
});

test('file catalog: unique paths, every template exists and every template is used', async () => {
  const catalog = fileCatalog(deriveNames({ name: 'sales-orders' }, naming));
  const paths = catalog.map((e) => e.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate catalog paths');
  const templates = (await readdir(TEMPLATES, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile())
    .map((d) => path.relative(TEMPLATES, path.join(d.parentPath, d.name)).replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(catalog.filter((e) => e.template).map((e) => e.template).sort(), templates);
  for (const e of catalog) {
    for (const field of /** @type {const} */ (['what', 'why', 'missing'])) assert.ok(e[field].length > 10, `${e.path}.${field}`);
  }
});

test('process helpers run commands without a shell and report failures', async () => {
  assert.match(await run(process.execPath, ['-e', 'process.stdout.write("ok")'], { cwd: process.cwd() }), /^ok$/);
  await assert.rejects(run(process.execPath, ['-e', 'console.error("bad"); process.exit(3)'], { cwd: process.cwd() }), /Command failed: .*\nbad/);
  assert.match(await npm(['--version'], process.cwd()), /^\d+\.\d+\.\d+/);
});
