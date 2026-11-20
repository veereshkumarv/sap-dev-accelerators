/**
 * What: Tests for odata-testgen: access derivation (CAP and roles.yaml), planning, both emitters,
 *     generation (output folder, stale-file cleanup, idempotency, errors), the CLI and an end-to-end
 *     run of the generated node:test files against a real CAP fixture app.
 * Why: Generated tests are only useful if they pass on a correct service and fail on a broken one;
 *     the end-to-end run proves the first, the unit tests pin each planning decision.
 * If missing or unlinked: The package fails the workspace guardrail and generator regressions
 *     produce broken test suites in consuming projects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadCapProjectInfo, loadCsn, loadServiceModel } from '@sapdx/sap-metadata';
import {
  accessFromCap,
  accessFromRolesFile,
  allowed,
  emitNodeTests,
  emitPostman,
  generateTests,
  GENERATED_MARKER,
  keyPredicate,
  pickUsers,
  planTests,
  runCli,
  sampleValue,
  toCheck,
} from '../src/index.js';

const run = promisify(execFile);
const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const APP = path.join(FIX, 'app');
const ROLES = path.join(FIX, 'roles.yaml');
const V2 = fileURLToPath(new URL('../../sap-metadata/test/fixtures/bp-v2.xml', import.meta.url));
// Inside the repository so the generated tests resolve @sap/cds from the workspace node_modules.
const WORK = fileURLToPath(new URL('./tmp/', import.meta.url));

const model = await loadServiceModel(APP);
const info = await loadCapProjectInfo(APP);
const access = accessFromCap(await loadCsn(APP), info.users);
const plans = planTests(model, { access, paths: info.paths });
const plan = plans[0];
const entity = (/** @type {string} */ name) => /** @type {import('../src/plan.js').EntityPlan} */ (plan.entities.find((e) => e.set.name === name));

async function copyApp() {
  await mkdir(WORK, { recursive: true });
  const dir = await mkdtemp(path.join(WORK, 'app-'));
  await cp(APP, dir, { recursive: true });
  return dir;
}

test('checks: public, authenticated, roles; allowed and user picking', () => {
  assert.deepEqual(toCheck(undefined), { public: true });
  assert.deepEqual(toCheck('any'), { public: true });
  assert.deepEqual(toCheck(['authenticated-user']), { anyUser: true });
  assert.deepEqual(toCheck(['Admin', 'Viewer']), { roles: ['Admin', 'Viewer'] });
  const alice = { name: 'alice', password: '', roles: ['Admin'] };
  const bob = { name: 'bob', password: '', roles: ['Viewer'] };
  assert.equal(allowed(undefined, [{ public: true }]), true);
  assert.equal(allowed(undefined, [{ anyUser: true }]), false);
  assert.equal(allowed(bob, [{ anyUser: true }, { roles: ['Admin'] }]), false);
  assert.deepEqual(pickUsers([alice, bob], [{ roles: ['Admin'] }]), { allowed: alice, denied: bob });
});

test('CAP access: service paths, users, read/write and operation roles', () => {
  assert.deepEqual(info.paths, { FixtureService: '/odata/v4/fixture' });
  // Project users merged with CAP's default mocked users (CAP decides the order).
  const roles = Object.fromEntries(access.users.map((u) => [u.name, u.roles]));
  assert.deepEqual([roles.alice, roles.bob, roles.eve], [['Admin'], ['Viewer'], []]);
  const orders = entity('Orders');
  assert.equal(orders.reader?.name, 'alice');
  assert.equal(orders.writer?.name, 'alice');
  assert.equal(orders.deniedWriter?.name, 'bob');
  assert.equal(orders.anonymousDenied, true);
  assert.equal(entity('Logs').reader, undefined, 'insert-only: nobody reads');
  const reset = plan.unbound.find((p) => p.op.name === 'reset');
  assert.equal(reset?.allowedUser?.name, 'alice');
  assert.equal(reset?.deniedUser?.name, 'bob');
  const touch = entity('Notes').boundOperations[0];
  assert.equal(touch.op.name, 'touch');
  assert.equal(touch.deniedUser?.name, 'bob', 'grant * to Admin covers bound actions');
});

test('planning: payload, mandatory, typed and string properties, capabilities', () => {
  const orders = entity('Orders');
  assert.deepEqual(orders.mandatory, ['customer']);
  assert.equal(orders.stringProperty?.name, 'customer');
  assert.equal(orders.typedProperty?.name, 'quantity');
  assert.ok(!('ID' in orders.payload), 'computed UUID key is not sent');
  assert.equal(entity('Products').set.capabilities.insertable, false);
  assert.equal(entity('Notes').set.etag, true);
  assert.equal(entity('Orders').set.draft, true);
  const products = entity('Products');
  assert.ok('code' in products.payload, 'client-provided key is part of the payload');
  const noAccess = planTests(model, { paths: {} });
  assert.equal(noAccess[0].basePath, '/FixtureService');
  assert.equal(noAccess[0].entities[0].reader, undefined);
  const excluded = planTests(model, { access, paths: info.paths, include: (s) => s.name !== 'Logs' });
  assert.ok(!excluded[0].entities.some((e) => e.set.name === 'Logs'));
});

test('sample values and key predicates', () => {
  assert.equal(sampleValue({ type: 'Edm.String', maxLength: 2 }, 12), 'T1');
  assert.equal(sampleValue({ type: 'Edm.String' }, 3), 'T3');
  for (const t of ['Edm.Int16', 'Edm.Int32', 'Edm.Int64', 'Edm.Byte', 'Edm.SByte', 'Edm.Decimal', 'Edm.Double', 'Edm.Single']) assert.equal(sampleValue({ type: t }, 1), 1);
  assert.equal(sampleValue({ type: 'Edm.Boolean' }, 1), true);
  assert.equal(sampleValue({ type: 'Edm.Date' }, 1), '2026-01-01');
  assert.equal(sampleValue({ type: 'Edm.DateTimeOffset' }, 1), '2026-01-01T00:00:00Z');
  assert.equal(sampleValue({ type: 'Edm.TimeOfDay' }, 1), '12:00:00');
  assert.match(String(sampleValue({ type: 'Edm.Guid' }, 1)), /^[0-9a-f-]{36}$/);
  assert.equal(sampleValue({ type: 'Edm.Stream' }, 1), undefined);
  const set = /** @type {any} */ ({ keys: ['ID'], properties: [{ name: 'ID', type: 'Edm.Guid' }] });
  assert.equal(keyPredicate(set, { ID: 'a' }), '(a)');
  assert.equal(keyPredicate(set, { ID: 'a' }, true), '(ID=a,IsActiveEntity=true)');
  const composite = /** @type {any} */ ({ keys: ['a', 'b'], properties: [{ name: 'a', type: 'Edm.String' }, { name: 'b', type: 'Edm.Int32' }] });
  assert.equal(keyPredicate(composite, { a: "o'k", b: 2 }), "(a='o''k',b=2)");
});

test('node:test emitter: header, marker, draft protocol, ETag, operations', () => {
  const files = emitNodeTests(plans, { projectRoot: '../..', command: 'npx odata-testgen --input . --emit node-test' });
  assert.deepEqual(files.map((f) => f.path).sort(), [
    'FixtureService.Logs.test.js',
    'FixtureService.Notes.test.js',
    'FixtureService.Orders.test.js',
    'FixtureService.Products.test.js',
    'FixtureService.operations.test.js',
  ]);
  const text = (/** @type {string} */ name) => /** @type {string} */ (files.find((f) => f.path === name)?.content);
  for (const f of files) {
    assert.match(f.content, /^\/\*\*\n \* What: GENERATED by odata-testgen/);
    assert.match(f.content, /\* Why: [\s\S]*\* If missing or unlinked:/);
    assert.ok(f.content.includes(GENERATED_MARKER));
    assert.match(f.content, /cds\.test\(`\$\{import\.meta\.dirname\}\/\.\.\/\.\.`\)/);
  }
  assert.match(text('FixtureService.Orders.test.js'), /draftEdit[\s\S]*draftActivate/);
  assert.match(text('FixtureService.Orders.test.js'), /rejects activation with missing mandatory fields/);
  assert.match(text('FixtureService.Notes.test.js'), /'If-Match': entity\['@odata\.etag'\]/);
  assert.match(text('FixtureService.Notes.test.js'), /stale ETag with 412/);
  assert.match(text('FixtureService.Logs.test.js'), /\[201, 204\]\.includes/);
  assert.doesNotMatch(text('FixtureService.Products.test.js'), /creates an entity/);
  assert.match(text('FixtureService.operations.test.js'), /function ping[\s\S]*action reset is forbidden for bob/);
});

test('Postman emitter: variables, folders, ETag handling, insert-only', () => {
  const c = /** @type {any} */ (emitPostman(plans, { name: 'FixtureService', command: 'npx odata-testgen' }));
  assert.equal(c.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  assert.deepEqual(c.variable.map((/** @type {any} */ v) => v.key).slice(0, 3), ['baseUrl', 'user_alice', 'password_alice']);
  assert.deepEqual(c.item.map((/** @type {any} */ f) => f.name), ['FixtureService.Logs', 'FixtureService.Notes', 'FixtureService.Orders', 'FixtureService.Products', 'FixtureService operations']);
  const notes = c.item[1].item;
  const update = notes.find((/** @type {any} */ i) => i.name === 'update text');
  assert.deepEqual(update.request.header.find((/** @type {any} */ h) => h.key === 'If-Match'), { key: 'If-Match', value: '{{etag_Notes}}' });
  assert.ok(update.event[0].script.exec.some((/** @type {string} */ l) => l.includes("'etag_Notes'")), 'ETag recaptured after update');
  assert.equal(typeof update.request.url, 'string');
  const logs = c.item[0].item.map((/** @type {any} */ i) => i.name);
  assert.equal(logs.at(-1), 'create as alice', 'insert-only: no follow-up requests');
  const anonymous = notes.find((/** @type {any} */ i) => i.name === 'anonymous read -> 401');
  assert.deepEqual(anonymous.request.auth, { type: 'noauth' });
});

test('generateTests: default folder, stale cleanup, hand-written files kept, idempotent', async () => {
  const dir = await copyApp();
  const out = path.join(dir, 'test', 'generated');
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'Old.Removed.test.js'), `// ${GENERATED_MARKER}\n`);
  await writeFile(path.join(out, 'my-scenario.test.js'), '// hand-written\n');
  const first = await generateTests({ input: dir, emit: 'node-test' });
  assert.deepEqual(first.removed.map((f) => path.basename(f)), ['Old.Removed.test.js']);
  assert.ok((await readdir(out)).includes('my-scenario.test.js'));
  const before = await readFile(path.join(out, 'FixtureService.Orders.test.js'), 'utf8');
  await generateTests({ input: dir, emit: 'node-test' });
  assert.equal(await readFile(path.join(out, 'FixtureService.Orders.test.js'), 'utf8'), before);
  await rm(dir, { recursive: true, force: true });
});

test('generateTests: postman for EDMX with roles.yaml and base path; input errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tg-'));
  const target = path.join(dir, 'out', 'bp.json');
  const result = await generateTests({ input: V2, emit: 'postman', out: target, roles: ROLES, basePath: '/sap/opu/odata/sap/API_BUSINESS_PARTNER/' });
  assert.equal(result.plans[0].basePath, '/sap/opu/odata/sap/API_BUSINESS_PARTNER');
  const bp = result.plans[0].entities[0];
  assert.equal(bp.reader?.name, 'admin');
  assert.equal(bp.deniedWriter?.name, 'viewer');
  assert.equal(result.plans[0].unbound[0].deniedUser?.name, 'viewer');
  assert.match(await readFile(target, 'utf8'), /API_BUSINESS_PARTNER\/A_BusinessPartner/);

  await assert.rejects(generateTests({ input: V2, emit: 'node-test' }), /needs a CAP project/);
  await assert.rejects(generateTests({ input: APP, emit: /** @type {any} */ ('junit') }), /Unknown --emit/);
  await assert.rejects(generateTests({ input: APP, emit: 'postman', service: 'Nope', out: target }), /Service Nope not found/);
  await assert.rejects(accessFromRolesFile(path.join(dir, 'missing.yaml')), /Cannot read roles file/);
  await writeFile(path.join(dir, 'bad.yaml'), 'requires: any\n');
  await assert.rejects(accessFromRolesFile(path.join(dir, 'bad.yaml')), /"users" map is required/);
});

test('CLI: help, usage errors, summary output, no-users note', async () => {
  /** @type {string[]} */
  let out = [];
  /** @type {string[]} */
  let err = [];
  const io = { stdout: (/** @type {string} */ s) => out.push(s), stderr: (/** @type {string} */ s) => err.push(s) };
  assert.equal(await runCli(['--help'], io), 0);
  assert.match(out[0], /^Usage: odata-testgen/);
  assert.equal(await runCli(['--emit', 'postman'], io), 2);
  assert.match(err.join('\n'), /--input and --emit are required/);
  err = [];
  assert.equal(await runCli(['--bogus'], io), 2);

  const dir = await mkdtemp(path.join(tmpdir(), 'tg-cli-'));
  out = [];
  assert.equal(await runCli(['--input', V2, '--emit', 'postman', '--out', path.join(dir, 'c.json')], io), 0);
  assert.match(out.join('\n'), /no users known - pass --roles/);
  assert.match(out.join('\n'), /no users: authorization tests skipped/);
  out = [];
  assert.equal(await runCli(['--input', APP, '--emit', 'postman', '--out', path.join(dir, 'app.json'), '--exclude', 'Logs'], io), 0);
  assert.match(out.join('\n'), /Orders \[draft\] - read: alice, write: alice/);
  assert.doesNotMatch(out.join('\n'), /\bLogs\b/);
});

test('end to end: generated node:test files pass against the CAP fixture app', async () => {
  const dir = await copyApp();
  await generateTests({ input: dir, emit: 'node-test' });
  // Without NODE_TEST_CONTEXT the child prints its own report instead of streaming to this runner.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await run(process.execPath, ['--test', 'test/generated/*.test.js'], { cwd: dir, env, timeout: 180_000 }).catch((e) => {
    assert.fail(`generated tests failed:\n${e.stdout}\n${e.stderr}`);
  });
  assert.match(stdout, /ℹ fail 0/);
  const passed = Number(/ℹ pass (\d+)/.exec(stdout)?.[1]);
  assert.ok(passed >= 30, `expected >= 30 passing generated tests, got ${passed}`);
  await rm(dir, { recursive: true, force: true });
});
