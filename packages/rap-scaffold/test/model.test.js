/**
 * What: Unit tests for model normalisation and validation, DDIC field building and abapGit XML
 *     serialization of rap-scaffold.
 * Why: Names, keys, types and metadata formats decide whether generated objects import and
 *     activate; each rule and each error message must be proven.
 * If missing or unlinked: The package fails the workspace guardrail and model/format regressions
 *     reach generated repositories unnoticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUNDLED_POLICY_DIR, loadPolicy } from '@sapdx/policy';
import { ModelError, normalizeModel, parseModelText, pascal } from '../src/index.js';
import { activeTableFields, builtinSpec, draftTableFields } from '../src/ddic.js';
import * as xml from '../src/abapgit.js';

const { naming } = await loadPolicy(BUNDLED_POLICY_DIR);
const example = parseModelText(await readFile(new URL('../examples/sales-order.yaml', import.meta.url), 'utf8'));
const minimal = () => ({
  area: 'SD',
  package: 'ZSD_X',
  description: 'Test',
  authorizationObject: 'ZSD_X',
  root: { name: 'THING', fields: [{ name: 'CODE', type: 'char', length: 4, mandatory: true }] },
});

/** @param {any} raw */
function problemsOf(raw) {
  try {
    normalizeModel(raw, naming);
  } catch (err) {
    assert.ok(err instanceof ModelError);
    return /** @type {ModelError} */ (err).problems.join('\n');
  }
  assert.fail('expected ModelError');
}

test('normalises the example model with policy names, keys and admin fields', () => {
  const m = normalizeModel(example, naming);
  assert.equal(m.draft, true);
  assert.deepEqual(
    [m.root.names.table, m.root.names.draftTable, m.root.names.baseView, m.root.names.projectionView, m.root.names.behaviorPool, m.root.names.serviceBinding],
    ['ZSD_ORDER', 'ZSD_ORDER_D', 'ZR_SD_ORDER', 'ZC_SD_ORDER', 'ZBP_R_SD_ORDER', 'ZUI_SD_ORDER_O4'],
  );
  assert.equal(m.root.alias, 'Order');
  assert.equal(m.root.assoc, '_Order');
  assert.deepEqual(m.root.fields[0], {
    column: 'ORDER_UUID', element: 'OrderUUID', label: 'Sales Order UUID', type: { kind: 'dtel', name: 'SYSUUID_X16' }, key: true, mandatory: false, readonly: true,
  });
  assert.deepEqual(m.root.fields.slice(-5).map((f) => f.admin), ['createdBy', 'createdAt', 'localChangedBy', 'localChangedAt', 'lastChangedAt']);
  assert.equal(m.root.fields.find((f) => f.column === 'NET_AMOUNT')?.currency, 'CurrencyCode');
  const item = m.children[0];
  assert.equal(item.fields[1].parentKey, true);
  assert.equal(item.fields[1].element, 'OrderUUID');
  assert.deepEqual(item.fields.slice(-1).map((f) => f.admin), ['localChangedAt']);
});

test('defaults: alias from name, draft true, element from column; explicit overrides win', () => {
  const m = normalizeModel({ ...minimal(), draft: false, root: { name: 'BIG_THING', alias: 'Thing', fields: [{ name: 'A_B', element: 'Ab', type: 'int4' }] } }, naming);
  assert.equal(m.draft, false);
  assert.equal(m.root.alias, 'Thing');
  assert.equal(m.root.fields[1].element, 'Ab');
  assert.equal(normalizeModel(minimal(), naming).root.alias, 'Thing');
  assert.equal(pascal('SALES_ORDER_ITEM'), 'SalesOrderItem');
});

test('top-level validation lists all problems at once', () => {
  const problems = problemsOf({ area: 'sales', package: 'XYZ', description: '', authorizationObject: 'S_TABU_DIS', draft: 'yes', children: {} });
  for (const expected of ['area:', 'package:', 'description:', 'authorizationObject:', 'draft:', 'root:', 'children:']) {
    assert.match(problems, new RegExp(expected));
  }
  assert.throws(() => normalizeModel(null, naming), /Model must be an object/);
  assert.throws(() => parseModelText('a: ['), /not valid YAML/);
});

test('entity and field validation', () => {
  const raw = minimal();
  raw.root = /** @type {any} */ ({
    name: 'THING',
    alias: 'bad alias',
    fields: [
      { name: 'lower' },
      { name: 'CLIENT', type: 'char', length: 1 },
      { name: 'A', type: 'char', length: 0 },
      { name: 'B', type: 'dec', length: 40, decimals: 20 },
      { name: 'C', type: 'float' },
      { name: 'D', dataElement: 'bad name' },
      { name: 'E', dataElement: 'ZDE_E', mandatory: true },
      { name: 'F', type: 'curr', length: 10, decimals: 2, currency: 'A' },
      { name: 'G', element: 'B', type: 'int4' },
      { name: 'H', element: 'lower', type: 'int4' },
      { name: 'A', type: 'char', length: 2 },
    ],
  });
  const problems = problemsOf(raw);
  for (const expected of [
    'root.alias: PascalCase',
    'fields\\[0\\].name',
    'CLIENT is reserved',
    'fields\\[2\\].length: 1-255',
    'fields\\[3\\].length: 1-31',
    'fields\\[3\\].decimals: 0-14',
    'fields\\[4\\].type: one of',
    'fields\\[5\\].dataElement',
    'fields\\[6\\].sample',
    'F.currency must name a cuky field',
    'fields\\[8\\].element: duplicate element B',
    'fields\\[9\\].element: PascalCase',
    'A is reserved or duplicate',
  ]) {
    assert.match(problems, new RegExp(expected), expected);
  }
});

test('entity-level checks: names, duplicates, fields, naming limits, alias clash, admin clash', () => {
  assert.match(problemsOf({ ...minimal(), root: { name: 'bad' } }), /root\.name/);
  assert.match(problemsOf({ ...minimal(), children: [{ name: 'THING', fields: [{ name: 'X', type: 'int4' }] }] }), /duplicate entity THING/);
  assert.match(problemsOf({ ...minimal(), root: { name: 'THING', fields: [] } }), /at least one field/);
  assert.match(problemsOf({ ...minimal(), root: { name: 'VERYLONGENTITYNAME', fields: [{ name: 'X', type: 'int4' }] } }), /max 16/);
  assert.match(problemsOf({ ...minimal(), children: [{ name: 'OTHER', alias: 'Thing', fields: [{ name: 'X', type: 'int4' }] }] }), /aliases must be unique/);
  assert.match(problemsOf({ ...minimal(), root: { name: 'THING', fields: [{ name: 'X', element: 'LastChangedAt', type: 'int4' }] } }), /reserved for administrative fields/);
});

test('builtinSpec maps every supported DDIC type', () => {
  assert.deepEqual(builtinSpec('char', 10), { inttype: 'C', intlen: 20, leng: 10 });
  assert.deepEqual(builtinSpec('numc', 4), { inttype: 'N', intlen: 8, leng: 4 });
  assert.deepEqual(builtinSpec('int4'), { inttype: 'X', intlen: 4, leng: 10 });
  assert.deepEqual(builtinSpec('dec', 15, 2), { inttype: 'P', intlen: 8, leng: 15, decimals: 2 });
  assert.deepEqual(builtinSpec('curr', 15, 2), { inttype: 'P', intlen: 8, leng: 15, decimals: 2 });
  assert.deepEqual(builtinSpec('cuky'), { inttype: 'C', intlen: 10, leng: 5 });
  assert.deepEqual(builtinSpec('dats'), { inttype: 'D', intlen: 16, leng: 8 });
  assert.deepEqual(builtinSpec('tims'), { inttype: 'T', intlen: 12, leng: 6 });
  assert.throws(() => builtinSpec(/** @type {any} */ ('fltp')), /Unsupported/);
});

test('table fields: client, keys, currency references and draft include', () => {
  const m = normalizeModel(example, naming);
  const active = activeTableFields(m.root);
  assert.deepEqual(active[0].slice(0, 2), [['FIELDNAME', 'CLIENT'], ['KEYFLAG', 'X']]);
  const key = active[1];
  assert.ok(key.some(([k, v]) => k === 'KEYFLAG' && v === 'X') && key.some(([k, v]) => k === 'NOTNULL' && v === 'X'));
  const amount = /** @type {any[]} */ (active.find((f) => f[0][1] === 'NET_AMOUNT'));
  assert.deepEqual(amount.filter(([k]) => ['REFTABLE', 'REFFIELD', 'DATATYPE', 'DECIMALS'].includes(k)), [
    ['REFTABLE', 'ZSD_ORDER'], ['REFFIELD', 'CURRENCY_CODE'], ['DATATYPE', 'CURR'], ['DECIMALS', '000002'],
  ]);
  const draft = draftTableFields(m.root);
  assert.equal(draft[0][0][1], 'MANDT');
  assert.ok(draft.some((f) => f[0][1] === 'NETAMOUNT'), 'draft fields use upper-case element names');
  const draftAmount = /** @type {any[]} */ (draft.find((f) => f[0][1] === 'NETAMOUNT'));
  assert.deepEqual(draftAmount.filter(([k]) => ['REFTABLE', 'REFFIELD'].includes(k)), [['REFTABLE', 'ZSD_ORDER_D'], ['REFFIELD', 'CURRENCYCODE']]);
  assert.deepEqual(draft.at(-1)?.find(([k]) => k === 'PRECFIELD'), ['PRECFIELD', 'SYCH_BDL_DRAFT_ADMIN_INC']);
});

test('abapGit XML: BOM, serializer, escaping and object-specific flags', () => {
  const ddls = xml.ddlsXml('ZR_X', 'A & B <c>', 'W');
  assert.ok(ddls.startsWith('﻿<?xml version="1.0" encoding="utf-8"?>'));
  assert.match(ddls, /serializer="LCL_OBJECT_DDLS"/);
  assert.match(ddls, /<DDTEXT>A &amp; B &lt;c&gt;<\/DDTEXT>/);
  assert.match(ddls, /<SOURCE_TYPE>W<\/SOURCE_TYPE>/);
  assert.equal(xml.esc(`"'`), '&quot;&apos;');
  const draft = xml.tablXml({ name: 'ZT_D', description: 'd', draft: true, fields: [] });
  assert.match(draft, /<EXCLASS>4<\/EXCLASS>[\s\S]*<TABART>APPL1<\/TABART>/);
  assert.match(draft, /<LANGDEP>X<\/LANGDEP>/);
  const active = xml.tablXml({ name: 'ZT', description: 'a', draft: false, fields: [] });
  assert.match(active, /<EXCLASS>1<\/EXCLASS>[\s\S]*<TABART>APPL0<\/TABART>/);
  assert.doesNotMatch(active, /LANGDEP/);
  assert.match(xml.srvbXml('ZUI_X_O4', 'ZUI_X', 'd'), /<PUBLISHED>false<\/PUBLISHED>[\s\S]*<ALLOWED_ACTION>PUBLISH<\/ALLOWED_ACTION>/);
  assert.match(xml.srvbXml('ZUI_X_O4', 'ZUI_X', 'd'), /<URI>\/sap\/bc\/adt\/ddic\/srvd\/sources\/zui_x<\/URI>/);
  assert.match(xml.bdefXml('ZR_X', 'd'), /<SOURCE_URI>\.\/zr_x\/source\/main<\/SOURCE_URI>/);
  assert.match(xml.clasXml('ZBP_X', 'd', 'ZR_X'), /<CATEGORY>06<\/CATEGORY>[\s\S]*<UNICODE>5<\/UNICODE>[\s\S]*<CLSDEFINT>ZR_X<\/CLSDEFINT>/);
  assert.match(xml.repositoryXml(), /<STARTING_FOLDER>\/src\/<\/STARTING_FOLDER>/);
  assert.match(xml.devcXml('Pkg'), /<CTEXT>Pkg<\/CTEXT>/);
  assert.match(xml.ddlxXml('ZC_X', 'd'), /serializer="LCL_OBJECT_DDLX"/);
  assert.match(xml.dclsXml('ZR_X', 'd'), /<DCLNAME>ZR_X<\/DCLNAME>/);
  assert.match(xml.srvdXml('ZUI_X', 'd'), /<SRVD_SOURCE_TYPE>S<\/SRVD_SOURCE_TYPE>/);
});
