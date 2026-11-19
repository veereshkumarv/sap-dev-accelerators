/**
 * What: Tests for odata-diff: every breaking/additive rule on synthetic service models, the version
 *     recommendation, policy application (exemptions) and the CLI (text, JSON, SARIF, snapshot).
 * Why: A missed breaking change breaks consumers; a false one blocks releases. Each rule is proven
 *     in isolation and end to end on real CAP projects.
 * If missing or unlinked: The package fails the workspace guardrail and diff regressions go unnoticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromSarif } from '@sapdx/findings';
import { BUNDLED_POLICY_DIR, loadPolicy } from '@sapdx/policy';
import { compareApis, diffServiceModels, recommendBump, runCli, toJsonReport, toText } from '../src/index.js';

const policy = await loadPolicy(BUNDLED_POLICY_DIR);
const CAP = fileURLToPath(new URL('../../sap-metadata/test/fixtures/cap', import.meta.url));

/** @returns {import('@sapdx/sap-metadata').Property} */
const prop = (/** @type {string} */ name, /** @type {Partial<import('@sapdx/sap-metadata').Property>} */ extra = {}) => ({
  name, type: 'Edm.String', nullable: true, key: false, computed: false, immutable: false, mandatory: false, foreignKey: false, maxLength: 10, ...extra,
});
/** @returns {import('@sapdx/sap-metadata').ServiceModel} */
const model = (/** @type {any} */ overrides = {}) => ({
  formatVersion: 1,
  odataVersion: '4.0',
  services: [
    {
      name: 'S',
      entitySets: [
        {
          name: 'Orders',
          entityType: 'Orders',
          keys: ['ID'],
          properties: [prop('ID', { key: true, type: 'Edm.Guid', nullable: false, computed: true }), prop('note'), prop('amount', { type: 'Edm.Decimal', precision: 15, scale: 2, maxLength: undefined })],
          navigations: [{ name: 'items', target: 'Items', isCollection: true }],
          capabilities: { readable: true, insertable: true, updatable: true, deletable: true },
          draft: false,
          etag: false,
          ...overrides.orders,
        },
        ...(overrides.extraSets ?? []),
      ],
      operations: overrides.operations ?? [{ name: 'cancel', kind: 'action', bound: true, entitySet: 'Orders', parameters: [{ name: 'reason', type: 'Edm.String', nullable: true }], returnType: 'S.Orders' }],
    },
  ],
});
const rules = (/** @type {any} */ a, /** @type {any} */ b) => diffServiceModels(a, b).map((c) => `${c.ruleId} ${c.object}`);
const base = model();
const orders = base.services[0].entitySets[0];

test('identical models: no changes, patch', () => {
  assert.deepEqual(diffServiceModels(base, model()), []);
  assert.equal(recommendBump([]), 'patch');
});

test('removals: service, entity set, property, navigation, operation', () => {
  assert.deepEqual(rules(base, { ...base, services: [] }), ['ODATA-BRK-001 S']);
  assert.deepEqual(rules(model({ extraSets: [{ ...orders, name: 'Old' }] }), base), ['ODATA-BRK-001 S/Old']);
  assert.deepEqual(rules(base, model({ orders: { properties: orders.properties.filter((p) => p.name !== 'note') } })), ['ODATA-BRK-002 S/Orders/note']);
  assert.deepEqual(rules(base, model({ orders: { navigations: [] } })), ['ODATA-BRK-002 S/Orders/items']);
  assert.deepEqual(rules(base, model({ operations: [] })), ['ODATA-BRK-005 S/Orders/cancel()']);
});

test('additions: service, entity set, optional property, navigation, operation are compatible', () => {
  const added = rules(base, {
    ...model({
      extraSets: [{ ...orders, name: 'New' }],
      orders: { properties: [...orders.properties, prop('remark')], navigations: [...orders.navigations, { name: 'customer', target: 'Customers', isCollection: false }] },
      operations: [...base.services[0].operations, { name: 'ping', kind: 'function', bound: false, parameters: [] }],
    }),
    services: [...model().services.map((s) => ({ ...s, entitySets: [...s.entitySets, { ...orders, name: 'New' }], operations: [...s.operations, { name: 'ping', kind: 'function', bound: false, parameters: [] }] })), { name: 'T', entitySets: [], operations: [] }],
  });
  assert.ok(added.every((r) => r.startsWith('ODATA-CHG-001')), added.join('\n'));
  assert.ok(added.includes('ODATA-CHG-001 T'));
  assert.ok(added.includes('ODATA-CHG-001 S/New'));
  assert.ok(added.includes('ODATA-CHG-001 S/ping()'));
  assert.equal(recommendBump(diffServiceModels(base, model({ orders: { properties: [...orders.properties, prop('remark')] } }))), 'minor');
});

test('types: changed type, narrowed and widened ranges', () => {
  const changed = model({ orders: { properties: orders.properties.map((p) => (p.name === 'note' ? { ...p, type: 'Edm.Int32' } : p)) } });
  assert.deepEqual(rules(base, changed), ['ODATA-BRK-003 S/Orders/note']);
  const narrowed = model({ orders: { properties: orders.properties.map((p) => (p.name === 'amount' ? { ...p, precision: 10, scale: 1 } : p.name === 'note' ? { ...p, maxLength: 5 } : p)) } });
  const messages = diffServiceModels(base, narrowed).map((c) => c.message);
  assert.ok(messages.some((m) => /precision 15 -> 10, scale 2 -> 1/.test(m)));
  assert.ok(messages.some((m) => /maxLength 10 -> 5/.test(m)));
  const widened = model({ orders: { properties: orders.properties.map((p) => (p.name === 'note' ? { ...p, maxLength: 40 } : p)) } });
  assert.deepEqual(rules(base, widened), ['ODATA-CHG-001 S/Orders/note']);
  const unlimited = model({ orders: { properties: orders.properties.map((p) => (p.name === 'note' ? { ...p, maxLength: undefined } : p)) } });
  assert.deepEqual(rules(base, unlimited), ['ODATA-CHG-001 S/Orders/note']);
});

test('mandatory and nullability', () => {
  const newMandatory = model({ orders: { properties: [...orders.properties, prop('region', { mandatory: true })] } });
  assert.deepEqual(rules(base, newMandatory), ['ODATA-BRK-004 S/Orders/region']);
  const readOnlySet = { capabilities: { ...orders.capabilities, insertable: false } };
  assert.deepEqual(rules(model({ orders: readOnlySet }), model({ orders: { ...readOnlySet, properties: [...orders.properties, prop('region', { mandatory: true })] } })), ['ODATA-CHG-001 S/Orders/region'], 'not breaking when nobody can create');
  const becameMandatory = model({ orders: { properties: orders.properties.map((p) => (p.name === 'note' ? { ...p, mandatory: true } : p)) } });
  assert.deepEqual(rules(base, becameMandatory), ['ODATA-BRK-004 S/Orders/note']);
  const notNull = model({ orders: { properties: orders.properties.map((p) => (p.name === 'note' ? { ...p, nullable: false } : p)) } });
  assert.deepEqual(rules(base, notNull), ['ODATA-BRK-004 S/Orders/note']);
});

test('write capabilities, computed/immutable, keys, draft, ETag, navigation target', () => {
  assert.deepEqual(rules(base, model({ orders: { capabilities: { ...orders.capabilities, deletable: false } } })), ['ODATA-BRK-007 S/Orders']);
  assert.deepEqual(rules(base, model({ orders: { capabilities: { ...orders.capabilities, readable: false } } })), ['ODATA-BRK-001 S/Orders']);
  assert.deepEqual(rules(model({ orders: { capabilities: { ...orders.capabilities, insertable: false } } }), base), ['ODATA-CHG-001 S/Orders']);
  assert.deepEqual(rules(base, model({ orders: { properties: orders.properties.map((p) => (p.name === 'note' ? { ...p, computed: true } : p)) } })), ['ODATA-BRK-007 S/Orders/note']);
  assert.deepEqual(rules(base, model({ orders: { properties: orders.properties.map((p) => (p.name === 'note' ? { ...p, immutable: true } : p)) } })), ['ODATA-BRK-007 S/Orders/note']);
  assert.deepEqual(rules(base, model({ orders: { keys: ['ID', 'note'] } })), ['ODATA-BRK-006 S/Orders']);
  assert.deepEqual(rules(base, model({ orders: { draft: true } })), ['ODATA-BRK-005 S/Orders']);
  assert.deepEqual(rules(base, model({ orders: { etag: true } })), ['ODATA-BRK-007 S/Orders']);
  assert.deepEqual(rules(model({ orders: { etag: true } }), base), ['ODATA-CHG-001 S/Orders']);
  assert.deepEqual(rules(base, model({ orders: { navigations: [{ name: 'items', target: 'Items', isCollection: false }] } })), ['ODATA-BRK-003 S/Orders/items']);
});

test('operations: kind, return type, parameters', () => {
  const op = base.services[0].operations[0];
  const withOp = (/** @type {any} */ o) => model({ operations: [{ ...op, ...o }] });
  assert.deepEqual(rules(base, withOp({ kind: 'function' })), ['ODATA-BRK-005 S/Orders/cancel()']);
  assert.deepEqual(rules(base, withOp({ returnType: undefined })), ['ODATA-BRK-005 S/Orders/cancel()']);
  assert.deepEqual(rules(base, withOp({ parameters: [] })), ['ODATA-BRK-005 S/Orders/cancel()']);
  assert.deepEqual(rules(base, withOp({ parameters: [...op.parameters, { name: 'x', type: 'Edm.Int32', nullable: true }] })), ['ODATA-CHG-001 S/Orders/cancel()']);
  assert.deepEqual(rules(base, withOp({ parameters: [...op.parameters, { name: 'x', type: 'Edm.Int32', nullable: false }] })), ['ODATA-BRK-005 S/Orders/cancel()']);
  assert.deepEqual(rules(base, withOp({ parameters: [{ ...op.parameters[0], type: 'Edm.Int32' }] })), ['ODATA-BRK-005 S/Orders/cancel()']);
  assert.deepEqual(rules(base, withOp({ parameters: [{ ...op.parameters[0], nullable: false }] })), ['ODATA-BRK-005 S/Orders/cancel()']);
});

test('policy: catalog severities, gate, exemptions, reports', async () => {
  const broken = model({ orders: { properties: orders.properties.filter((p) => p.name !== 'note') } });
  const result = compareApis(base, broken, { policy });
  assert.equal(result.findings[0].severity, 'critical');
  assert.equal(result.gate.passed, false);
  assert.deepEqual(result.summary, { recommendation: 'major', breaking: 1, breakingExempted: 0, additive: 0 });
  assert.match(toText(result), /BREAKING: 1 breaking change[\s\S]*GATE FAILED/);
  assert.equal(toJsonReport(result).gate, 'failed');

  const dir = await mkdtemp(path.join(tmpdir(), 'diff-policy-'));
  await cp(BUNDLED_POLICY_DIR, dir, { recursive: true });
  await writeFile(
    path.join(dir, 'exemptions.yaml'),
    JSON.stringify({
      version: 1,
      exemptions: [{ id: 'EXM-0007', rule: 'ODATA-BRK-002', object: 'S/Orders/note', owner: 'api.owner', approver: 'chief.architect', justification: 'Field unused by all consumers per API analytics.', created: '2026-11-01', expires: '2027-01-31', backlog: 'API-12' }],
    }),
  );
  const exempted = compareApis(base, broken, { policy: await loadPolicy(dir), today: '2026-11-18' });
  assert.equal(exempted.gate.passed, true);
  assert.equal(exempted.summary.breakingExempted, 1);
  assert.equal(toJsonReport(exempted).findings[0].exemption, 'EXM-0007');
  assert.match(toText(compareApis(base, model({ orders: { properties: [...orders.properties, prop('remark')] } }), { policy })), /Compatible: 1 additive/);
  assert.match(toText(compareApis(base, model(), { policy })), /No differences\.[\s\S]*No API changes/);
});

test('CLI: compare CAP projects, JSON/SARIF output, snapshot, usage errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'diff-cli-'));
  await cp(CAP, path.join(dir, 'v1'), { recursive: true });
  await cp(CAP, path.join(dir, 'v2'), { recursive: true });
  const cds = path.join(dir, 'v2', 'srv', 'demo.cds');
  await writeFile(cds, (await readFile(cds, 'utf8')).replace('note       : String(40);', 'note       : String(20);'));
  /** @type {string[]} */
  let out = [];
  /** @type {string[]} */
  let err = [];
  const io = { stdout: (/** @type {string} */ s) => out.push(s), stderr: (/** @type {string} */ s) => err.push(s) };
  const p = ['--policy', BUNDLED_POLICY_DIR];

  assert.equal(await runCli([path.join(dir, 'v1'), path.join(dir, 'v2'), ...p], io), 1);
  assert.match(out.join('\n'), /ODATA-BRK-003 .*Demo\/Orders\/note/);

  out = [];
  const json = path.join(dir, 'reports', 'diff.json');
  assert.equal(await runCli([path.join(dir, 'v1'), path.join(dir, 'v2'), ...p, '--format', 'json', '--out', json], io), 1);
  assert.deepEqual(JSON.parse(await readFile(json, 'utf8')).recommendation, 'major');
  assert.match(out.join('\n'), /1 breaking, 0 additive .*major/);

  const sarif = path.join(dir, 'diff.sarif');
  await runCli([path.join(dir, 'v1'), path.join(dir, 'v2'), ...p, '--format', 'sarif', '--out', sarif], io);
  assert.equal(fromSarif(JSON.parse(await readFile(sarif, 'utf8')))[0].ruleId, 'ODATA-BRK-003');

  out = [];
  const snap = path.join(dir, 'api.json');
  assert.equal(await runCli(['snapshot', path.join(dir, 'v1'), '--out', snap], io), 0);
  assert.match(out.join('\n'), /Snapshot of 1 service\(s\), 4 entity set\(s\)/);
  out = [];
  assert.equal(await runCli([snap, path.join(dir, 'v1'), ...p], io), 0);
  assert.match(out.join('\n'), /GATE PASSED/);

  out = [];
  assert.equal(await runCli(['--help'], io), 0);
  assert.match(out[0], /^Usage:/);
  for (const args of [['a'], ['snapshot', 'x'], [snap, snap, '--format', 'xml'], [snap, snap, '--today', 'x'], ['--bogus'], ['/no/a', '/no/b']]) {
    err = [];
    assert.equal(await runCli(args, io), 2, args.join(' '));
    assert.match(err.join('\n'), /odata-diff: /);
  }
});
