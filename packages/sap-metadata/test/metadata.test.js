/**
 * What: Tests for sap-metadata: V4 (CAP with draft, ETag, restrictions, operations), V2 (S/4-style
 *     sap: attributes), CAP project loading, snapshots, merging and error handling.
 * Why: Both the API diff and the test generator trust this model; a wrong flag (e.g. insertable)
 *     produces wrong breaking-change reports or wrong generated tests.
 * If missing or unlinked: The package fails the workspace guardrail and metadata regressions go
 *     unnoticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromEdmx, loadCsn, loadServiceModel, mergeModels, MetadataError, parseSnapshot } from '../src/index.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const cap = await loadServiceModel(path.join(FIX, 'cap'));
const demo = cap.services[0];
const set = (/** @type {string} */ name) => /** @type {import('../src/index.js').EntitySet} */ (demo.entitySets.find((e) => e.name === name));

test('CAP project: services, entity sets and operations', () => {
  assert.equal(cap.odataVersion, '4.0');
  assert.deepEqual(cap.services.map((s) => s.name), ['Demo']);
  assert.deepEqual(demo.entitySets.map((e) => e.name), ['Items', 'Logs', 'Orders', 'Products']);
  assert.deepEqual(demo.operations, [
    { name: 'ping', kind: 'function', bound: false, parameters: [{ name: 'text', type: 'Edm.String', nullable: true }], returnType: 'Edm.String' },
    { name: 'reset', kind: 'action', bound: false, parameters: [] },
  ]);
});

test('V4: draft, ETag, keys without draft plumbing, mandatory/computed/foreign keys', () => {
  const orders = set('Orders');
  assert.equal(orders.draft, true);
  assert.equal(orders.etag, true);
  assert.deepEqual(orders.keys, ['ID'], 'IsActiveEntity is draft plumbing');
  assert.ok(!orders.properties.some((p) => p.name === 'IsActiveEntity' || p.name === 'HasDraftEntity'));
  const prop = (/** @type {string} */ n) => orders.properties.find((p) => p.name === n);
  assert.equal(prop('customer')?.mandatory, true);
  assert.equal(prop('customer')?.maxLength, 10);
  assert.equal(prop('status')?.computed, true);
  assert.equal(prop('ID')?.computed, true);
  assert.equal(prop('amount')?.precision, 15);
  assert.equal(prop('amount')?.scale, 2);
  assert.deepEqual(orders.navigations, [{ name: 'items', target: 'Items', isCollection: true }]);
  const items = set('Items');
  assert.equal(items.properties.find((p) => p.name === 'order_ID')?.foreignKey, true);
  assert.equal(items.draft, true, 'composition children of a draft root are draft-enabled');
});

test('V4: capability restrictions from @readonly / @insertonly', () => {
  assert.deepEqual(set('Products').capabilities, { readable: true, insertable: false, updatable: false, deletable: false });
  assert.deepEqual(set('Logs').capabilities, { readable: false, insertable: true, updatable: false, deletable: false });
  assert.equal(set('Products').etag, false);
});

test('V2: version detection and sap: attributes', async () => {
  const v2 = await loadServiceModel(path.join(FIX, 'bp-v2.xml'));
  assert.equal(v2.odataVersion, '2.0');
  const bp = v2.services[0].entitySets[0];
  assert.equal(v2.services[0].name, 'API_BUSINESS_PARTNER');
  assert.equal(bp.capabilities.deletable, false);
  assert.equal(bp.capabilities.insertable, true);
  assert.equal(bp.properties.find((p) => p.name === 'BusinessPartnerFullName')?.computed, true);
  assert.equal(bp.properties.find((p) => p.name === 'BusinessPartnerCategory')?.mandatory, true, 'non-nullable non-key is mandatory');
  assert.equal(bp.properties.find((p) => p.name === 'BusinessPartner')?.mandatory, false, 'keys are not "mandatory" fields');
  assert.equal(v2.services[0].operations[0].name, 'CheckPartner');
});

test('snapshots round-trip; merging; deterministic ordering', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'md-'));
  const file = path.join(dir, 'snap.json');
  await writeFile(file, JSON.stringify(cap));
  assert.deepEqual(await loadServiceModel(file), cap);
  const merged = mergeModels([fromEdmx(await readFile(path.join(FIX, 'bp-v2.xml'), 'utf8')), cap]);
  assert.deepEqual(merged.services.map((s) => s.name), ['API_BUSINESS_PARTNER', 'Demo']);
  assert.equal(mergeModels([]).odataVersion, '4.0');
  assert.deepEqual(await loadServiceModel(path.join(FIX, 'cap')), cap, 'same input, same model');
});

test('errors: missing input, invalid EDMX, invalid snapshot, no CDS model, no service', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'md-err-'));
  await assert.rejects(loadServiceModel(path.join(dir, 'nope.xml')), /Input not found/);
  assert.throws(() => fromEdmx('<not-edmx'), MetadataError);
  await writeFile(path.join(dir, 'bad.json'), '{ "formatVersion": 2 }');
  await assert.rejects(loadServiceModel(path.join(dir, 'bad.json')), /Not a service-model snapshot/);
  await writeFile(path.join(dir, 'broken.json'), '{ broken');
  await assert.rejects(loadServiceModel(path.join(dir, 'broken.json')), /Invalid snapshot JSON/);
  assert.throws(() => parseSnapshot(null), MetadataError);
  await assert.rejects(loadServiceModel(dir), /No CDS model found/);

  const noService = await mkdtemp(path.join(tmpdir(), 'md-nosrv-'));
  await writeFile(path.join(noService, 'package.json'), '{"name":"x"}');
  await import('node:fs/promises').then((fs) => fs.mkdir(path.join(noService, 'db')));
  await writeFile(path.join(noService, 'db', 'schema.cds'), 'entity Things { key ID: Integer; }');
  await assert.rejects(loadServiceModel(noService), /defines no service/);
  await writeFile(path.join(noService, 'db', 'schema.cds'), 'entity {');
  await assert.rejects(loadServiceModel(noService), /does not compile/);
});

test('loadCsn returns the compiled model (used for role derivation)', async () => {
  const csn = await loadCsn(path.join(FIX, 'cap'));
  assert.equal(csn.definitions['Demo.Orders'].kind, 'entity');
  assert.equal(await loadCsn(await mkdtemp(path.join(tmpdir(), 'md-empty-'))), undefined);
});
