/**
 * What: Tests for abap-policy-lint: every rule fires on a violating fixture and stays quiet on a
 *     compliant one, released-API handling, repository loading, the generated RAP example as an
 *     integration case, and the CLI (lint, SARIF, baseline, update-released-apis).
 * Why: The ABAP gate can block releases; each rule must be proven in both directions and the
 *     false-positive fixes (RAP aliases, normalised lines) must not regress.
 * If missing or unlinked: The package fails the workspace guardrail and rule regressions go
 *     unnoticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBaseline, fromSarif } from '@sapdx/findings';
import { BUNDLED_POLICY_DIR, loadPolicy } from '@sapdx/policy';
import {
  compactReleaseInfo,
  downloadReleasedApis,
  indexCatalogue,
  lintRepository,
  loadReleasedApis,
  loadRepository,
  RepositoryError,
  ReleasedApisError,
  runCli,
} from '../src/index.js';
import { RELEASED_FIXTURE, classWith, clas, makeRepo, xml } from './helpers.js';

const policy = await loadPolicy(BUNDLED_POLICY_DIR);
const released = indexCatalogue(RELEASED_FIXTURE);
const RAP_EXAMPLE = fileURLToPath(new URL('../../rap-scaffold/examples/out', import.meta.url));
const ids = (/** @type {{ ruleId: string }[]} */ fs) => [...new Set(fs.map((f) => f.ruleId))].sort();

const BAD = {
  '.abapgit.xml': xml.repo('/src/'),
  ...classWith(
    'ZCL_BAD',
    `    DATA lt TYPE STANDARD TABLE OF mara WITH EMPTY KEY.
    DATA lo_old TYPE REF TO cl_old_api.
    DATA lo_salv TYPE REF TO cl_salv_table.
    DATA lo_gui TYPE REF TO cl_gui_frontend_services.
    SELECT * FROM mara INTO TABLE @lt.
    LOOP AT lt INTO DATA(ls).
      SELECT SINGLE * FROM vbak WHERE vbeln = @ls-matnr INTO @DATA(v).
    ENDLOOP.
    CALL FUNCTION 'POPUP_TO_CONFIRM'.
    SELECT * FROM t001 CLIENT SPECIFIED WHERE bukrs = '1010' INTO TABLE @DATA(c).
    IF ls-bukrs = '1010'.
    ENDIF.
    DATA(url) = 'https://s4.example.com/sap/opu/odata'.
    cl_abap_unit_assert=>assert_not_initial( url ).`,
  ),
  ...classWith('ZCL_NOT_CLOUD', "    WRITE 'classic list output'."),
  // Separate clean class: abaplint skips unused-variable analysis in objects with syntax errors.
  ...classWith('ZCL_UNUSED', '    DATA unused TYPE i.'),
  'src/zr_bad_view.ddls.asddls': `@AccessControl.authorizationCheck: #NOT_REQUIRED\ndefine view entity ZR_BAD_VIEW as select from zbad_t { key id as Id }\n`,
  'src/zr_bad_view.ddls.xml': xml.ddls('ZR_BAD_VIEW'),
  'src/zr_bad_nodcl.ddls.asddls': `@AccessControl.authorizationCheck: #CHECK\ndefine root view entity ZR_BAD_NODCL as select from zbad_t { key id as Id }\n`,
  'src/zr_bad_nodcl.ddls.xml': xml.ddls('ZR_BAD_NODCL'),
  'src/zr_bad_nodcl.bdef.asbdef': `managed implementation in class zcl_bad_pool unique;\nstrict ( 2 );\n\ndefine behavior for ZR_BAD_NODCL alias Bad\npersistent table zbad_t\nlock master\n{\n  create;\n  update;\n  delete;\n}\n`,
  'src/zr_bad_nodcl.bdef.xml': xml.bdef('ZR_BAD_NODCL'),
  ...clas('ZCL_BAD_POOL', 'CLASS zcl_bad_pool DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_bad_nodcl.\nENDCLASS.\n\nCLASS zcl_bad_pool IMPLEMENTATION.\nENDCLASS.\n'),
  ...clas('CL_SAP_STANDARD', 'CLASS cl_sap_standard DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\n\nCLASS cl_sap_standard IMPLEMENTATION.\nENDCLASS.\n'),
  'src/zenh_classic.enho.xml': xml.enho('ZENH_CLASSIC', 'HOOK_IMPL'),
  'src/zenh_badi.enho.xml': xml.enho('ZENH_BADI', 'BADI_IMPL'),
};

const GOOD = {
  '.abapgit.xml': xml.repo('/src/'),
  ...classWith(
    'ZCL_GOOD',
    `    SELECT product FROM i_product WHERE product = @( cl_abap_context_info=>get_user_technical_name( ) ) INTO TABLE @DATA(products).
    cl_abap_unit_assert=>assert_not_initial( products ).`,
  ),
  'src/zr_good.ddls.asddls': `@AccessControl.authorizationCheck: #CHECK\ndefine root view entity ZR_GOOD as select from zgood_t { key id as Id }\n`,
  'src/zr_good.ddls.xml': xml.ddls('ZR_GOOD'),
  'src/zr_good.dcls.asdcls': `@MappingRole: true\ndefine role ZR_GOOD {\n  grant select on ZR_GOOD where ( ) = aspect pfcg_auth( ZGOOD, ACTVT = '03' );\n}\n`,
  'src/zr_good.dcls.xml': xml.dcls('ZR_GOOD'),
  'src/zr_good.bdef.asbdef': `managed implementation in class zbp_r_good unique;\nstrict ( 2 );\n\ndefine behavior for ZR_GOOD alias Good\npersistent table zgood_t\nlock master\nauthorization master ( global )\n{\n  create;\n  update;\n  delete;\n}\n`,
  'src/zr_good.bdef.xml': xml.bdef('ZR_GOOD'),
  ...clas('ZBP_R_GOOD', 'CLASS zbp_r_good DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_good.\nENDCLASS.\n\nCLASS zbp_r_good IMPLEMENTATION.\nENDCLASS.\n', {
    locals: `CLASS lhc_good DEFINITION INHERITING FROM cl_abap_behavior_handler.\n  PRIVATE SECTION.\n    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION\n      IMPORTING REQUEST requested_authorizations FOR Good RESULT result.\nENDCLASS.\n\nCLASS lhc_good IMPLEMENTATION.\n  METHOD get_global_authorizations.\n    DATA(log) = cl_bali_log=>create( ).\n    IF log IS BOUND AND requested_authorizations-%create = if_abap_behv=>mk-on.\n      result-%create = if_abap_behv=>auth-allowed.\n    ENDIF.\n  ENDMETHOD.\nENDCLASS.\n`,
    tests: `CLASS ltc_good DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.\n  PRIVATE SECTION.\n    METHODS ok FOR TESTING.\nENDCLASS.\n\nCLASS ltc_good IMPLEMENTATION.\n  METHOD ok.\n    cl_abap_unit_assert=>assert_true( abap_true ).\n  ENDMETHOD.\nENDCLASS.\n`,
  }),
};

const bad = await lintRepository(await makeRepo(BAD), { policy, released });
const good = await lintRepository(await makeRepo(GOOD), { policy, released });

test('compliant repository has no findings', () => {
  assert.deepEqual(good.findings.map((f) => `${f.ruleId} ${f.message}`), []);
  assert.equal(good.gate.passed, true);
});

test('violating repository triggers every implemented ABAP rule', () => {
  assert.deepEqual(ids(bad.findings), [
    'ABAP-CC-001',
    'ABAP-CC-002',
    'ABAP-CC-003',
    'ABAP-CC-004',
    'ABAP-CC-005',
    'ABAP-CFG-001',
    'ABAP-DB-001',
    'ABAP-LANG-001',
    'ABAP-LINT-UNUSED_VARIABLES',
    'ABAP-LOG-001',
    'ABAP-NAME-001',
    'ABAP-PERF-001',
    'ABAP-PERF-002',
    'ABAP-SEC-001',
    'ABAP-SYNTAX-001',
    'ABAP-TEST-001',
  ]);
  assert.ok(bad.findings.some((f) => f.ruleId === 'ABAP-SYNTAX-001' && /POPUP_TO_CONFIRM" not found\/released/.test(f.message)), 'abaplint cloud check also flags the FM');
  assert.ok(bad.findings.some((f) => f.ruleId === 'ABAP-LANG-001' && f.object === 'CLAS ZCL_BAD'), 'CLIENT SPECIFIED is not ABAP Cloud');
  assert.equal(bad.gate.passed, false);
});

test('rule details: successors, objects and locations', () => {
  const by = (/** @type {string} */ id) => bad.findings.filter((f) => f.ruleId === id);
  assert.match(by('ABAP-CC-003').map((f) => f.message).join('\n'), /MARA is forbidden by policy; use I_Product[\s\S]*VBAK .*I_SalesDocument|VBAK .*I_SalesDocument[\s\S]*MARA/);
  assert.ok(by('ABAP-CC-004').some((f) => /POPUP_TO_CONFIRM/.test(f.message)));
  assert.ok(by('ABAP-CC-004').some((f) => /CL_GUI_FRONTEND_SERVICES/.test(f.message)));
  assert.deepEqual(by('ABAP-CC-001').map((f) => f.message.split(' is ')[0]), ['Class/interface CL_SALV_TABLE']);
  assert.ok(by('ABAP-CC-003').some((f) => /Table\/view MARA is forbidden/.test(f.message)), 'MARA used as a type gets the successor message');
  assert.match(by('ABAP-CC-005')[0].message, /CL_OLD_API is deprecated; use CL_NEW_API/);
  assert.deepEqual(by('ABAP-CC-002').map((f) => f.object).sort(), ['CLAS CL_SAP_STANDARD', 'ENHO ZENH_CLASSIC']);
  assert.deepEqual(by('ABAP-SEC-001').map((f) => f.object).sort(), ['BDEF ZR_BAD_NODCL#ZR_BAD_NODCL', 'DDLS ZR_BAD_NODCL#dcl', 'DDLS ZR_BAD_VIEW']);
  assert.equal(by('ABAP-CFG-001').length, 3, 'two org-value comparisons and one URL');
  assert.match(by('ABAP-LANG-001')[0].message, /not permitted .* WRITE|configured ABAP language version/);
  const loc = by('ABAP-PERF-001')[0].location;
  assert.equal(loc?.file, 'src/zcl_bad.clas.abap');
  assert.ok((loc?.line ?? 0) > 1);
  assert.ok(bad.findings.every((f) => !/\bline \d+/i.test(f.message)), 'no line numbers in messages');
});

test('without released-API catalogue CC-001/005 are skipped, not guessed', async () => {
  const result = await lintRepository(await makeRepo(BAD), { policy });
  assert.ok(!ids(result.findings).includes('ABAP-CC-001'));
  assert.ok(!ids(result.findings).includes('ABAP-CC-005'));
  assert.equal(result.info.releasedApis, undefined);
  assert.ok(ids(result.findings).includes('ABAP-CC-003'), 'forbidden-object rules still run');
});

test('on-premise version: WRITE is allowed, dangerous statements are reported', async () => {
  const repo = await makeRepo({ ...classWith('ZCL_ONPREM', "    WRITE 'x'.\n    CALL 'SYSTEM' ID 'COMMAND' FIELD 'ls'.") });
  const result = await lintRepository(repo, { policy, version: 'v758' });
  assert.ok(!ids(result.findings).includes('ABAP-LANG-001'));
  assert.ok(ids(result.findings).includes('ABAP-SEC-002'));
  await assert.rejects(lintRepository(repo, { policy, version: 'v999' }), /Unknown ABAP version/);
});

test('integration: generated RAP example passes the ABAP gate (only the logging hint)', async () => {
  const result = await lintRepository(RAP_EXAMPLE, { policy, released: await loadReleasedApis(await writeTmp(JSON.stringify(RELEASED_FIXTURE))) });
  assert.deepEqual(ids(result.findings), ['ABAP-CC-001', 'ABAP-LOG-001'].filter((id) => id !== 'ABAP-CC-001' || result.findings.some((f) => f.ruleId === id)));
  // With the fixture catalogue some SAP APIs are unknown; the real BTP list resolves them all.
  const noCatalogue = await lintRepository(RAP_EXAMPLE, { policy });
  assert.deepEqual(ids(noCatalogue.findings), ['ABAP-LOG-001']);
  assert.equal(noCatalogue.gate.passed, true);
  assert.ok(noCatalogue.info.knownGaps.length > 0, 'known gaps are reported');
  assert.equal(noCatalogue.info.normalized.length, 2);
});

test('repository loading: starting folder, missing folder, dotfiles skipped', async () => {
  const repo = await makeRepo({ '.abapgit.xml': xml.repo('/abap/'), ...classWith('ZCL_A', '    RETURN.').constructor === Object ? Object.fromEntries(Object.entries(classWith('ZCL_A', '    RETURN.')).map(([k, v]) => [k.replace(/^src\//, 'abap/'), v])) : {}, 'abap/.hidden/zx.clas.abap': 'x', 'README.md': '# readme' });
  const loaded = await loadRepository(repo);
  assert.equal(loaded.startingFolder, 'abap/');
  assert.deepEqual(loaded.files.map((f) => f.path), ['abap/zcl_a.clas.abap', 'abap/zcl_a.clas.xml']);
  await assert.rejects(loadRepository(path.join(repo, 'missing')), RepositoryError);
  await assert.rejects(loadRepository(await makeRepo({ '.abapgit.xml': xml.repo('/nothere/') })), /Starting folder "nothere\/" not found/);
  const noDescriptor = await makeRepo(classWith('ZCL_B', '    RETURN.'));
  assert.equal((await loadRepository(noDescriptor)).startingFolder, 'src/');
});

test('released-API catalogue: compacting SAP format, lookup precedence, errors', async () => {
  const raw = {
    formatVersion: '1',
    objectReleaseInfo: [
      { tadirObject: 'CLAS', tadirObjName: 'cl_x', objectType: 'CLAS', objectKey: 'CL_X', state: 'deprecated', successors: [{ objectKey: 'CL_Y' }] },
      { tadirObject: 'FUGR', tadirObjName: 'FG', objectType: 'FUNC', objectKey: 'FM_A', state: 'released' },
      { tadirObject: 'DOMA', tadirObjName: 'D1', objectType: 'DOMA', objectKey: 'D1', state: 'notToBeReleased' },
      { tadirObject: 'DTEL', tadirObjName: 'D1', objectType: 'DTEL', objectKey: 'D1', state: 'released' },
      { broken: true },
    ],
  };
  const compact = compactReleaseInfo(raw, 'btp');
  assert.equal(compact.objects.length, 4);
  assert.match(compact.source, /objectReleaseInfo_BTPLatest\.json$/);
  const idx = indexCatalogue(compact);
  assert.deepEqual(idx.lookup('cl_x'), { state: 'deprecated', successor: 'CL_Y' });
  assert.equal(idx.lookup('FM_A')?.state, 'released');
  assert.equal(idx.lookup('D1')?.state, 'released', 'best state wins across object types');
  assert.equal(idx.lookup('NOPE'), undefined);
  assert.throws(() => compactReleaseInfo({}, 'btp'), ReleasedApisError);
  assert.throws(() => indexCatalogue(/** @type {any} */ ({ formatVersion: 2 })), /formatVersion 1/);
  await assert.rejects(loadReleasedApis('/no/such/file.json'), /update-released-apis/);
  await assert.rejects(loadReleasedApis(await writeTmp('{')), /not valid JSON/);

  const fetchOk = /** @type {any} */ (async (/** @type {string} */ url) => ({ ok: true, status: 200, json: async () => ({ ...raw, url }) }));
  assert.equal((await downloadReleasedApis('pce', { fetchImpl: fetchOk })).variant, 'pce');
  const fetch404 = /** @type {any} */ (async () => ({ ok: false, status: 404 }));
  await assert.rejects(downloadReleasedApis('btp', { fetchImpl: fetch404 }), /HTTP 404/);
  await assert.rejects(downloadReleasedApis('mars'), /Unknown variant/);
});

test('baseline and exemptions work like every other tool', async () => {
  const repo = await makeRepo(BAD);
  const baseline = createBaseline(bad.findings);
  const again = await lintRepository(repo, { policy, released, baseline });
  assert.deepEqual([...new Set(again.gate.blocking.map((f) => f.ruleId))], ['ABAP-CC-002'], 'modifications can never be baselined');
});

test('CLI: lint text and SARIF, notes, baseline, update-released-apis, usage errors', async () => {
  /** @type {string[]} */
  let out = [];
  /** @type {string[]} */
  let err = [];
  const io = {
    stdout: (/** @type {string} */ s) => out.push(s),
    stderr: (/** @type {string} */ s) => err.push(s),
    fetchImpl: /** @type {any} */ (async () => ({ ok: true, status: 200, json: async () => ({ objectReleaseInfo: [{ tadirObject: 'CLAS', tadirObjName: 'CL_A', objectType: 'CLAS', objectKey: 'CL_A', state: 'released' }] }) })),
  };
  const repo = await makeRepo(BAD);
  const goodRepo = await makeRepo(GOOD);
  const cache = await writeTmp(JSON.stringify(RELEASED_FIXTURE));

  assert.equal(await runCli([goodRepo, '--policy', BUNDLED_POLICY_DIR, '--released-apis', cache], io), 0);
  assert.match(out.join('\n'), /GATE PASSED/);
  out = [];
  assert.equal(await runCli([goodRepo, '--policy', BUNDLED_POLICY_DIR], io), 0);
  assert.match(out.join('\n'), /WARNING: no released-API cache/);

  out = [];
  const sarifFile = path.join(await mkdtemp(path.join(tmpdir(), 'abap-cli-')), 'abap.sarif');
  assert.equal(await runCli([repo, '--policy', BUNDLED_POLICY_DIR, '--released-apis', cache, '--format', 'sarif', '--out', sarifFile, '--today', '2026-11-18'], io), 1);
  const findings = fromSarif(JSON.parse(await readFile(sarifFile, 'utf8')));
  assert.ok(findings.length >= 15);
  assert.match(out.join('\n'), /written to .*gate failed/);

  const baselineFile = await writeTmp(JSON.stringify(createBaseline(findings)));
  out = [];
  assert.equal(await runCli([repo, '--policy', BUNDLED_POLICY_DIR, '--released-apis', cache, '--baseline', baselineFile], io), 1);
  assert.match(out.join('\n'), /GATE FAILED: 2 new/, 'only the two modifications remain blocking');

  out = [];
  const target = path.join(await mkdtemp(path.join(tmpdir(), 'abap-rel-')), 'nested', 'released.json');
  assert.equal(await runCli(['update-released-apis', '--variant', 'public', '--out', target], io), 0);
  assert.match(out.join('\n'), /Saved 1 SAP objects \(1 released\) for "public"/);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).variant, 'public');

  // --deps: a class using a customer data element defined in another repository
  const depRepo = await makeRepo(classWith('ZCL_USES_DEP', "    DATA code TYPE zde_code.\n    cl_abap_unit_assert=>assert_initial( code )."));
  const depsDir = fileURLToPath(new URL('../../rap-scaffold/test/fixtures/deps', import.meta.url));
  out = [];
  assert.equal(await runCli([depRepo, '--policy', BUNDLED_POLICY_DIR], io), 0);
  assert.match(out.join('\n'), /ABAP-SYNTAX-001.*ZDE_CODE/, 'unknown without --deps (reported, not blocking)');
  out = [];
  assert.equal(await runCli([depRepo, '--policy', BUNDLED_POLICY_DIR, '--deps', depsDir], io), 0);
  assert.doesNotMatch(out.join('\n'), /ZDE_CODE/, 'resolved with --deps');

  out = [];
  assert.equal(await runCli(['--help'], io), 0);
  assert.match(out[0], /^Usage:/);
  for (const args of [['a', 'b'], ['--format', 'xml'], ['--today', 'x'], ['--abap-version', 'v1'], ['update-released-apis', '--variant', 'x'], ['--nope'], ['/no/such/repo']]) {
    err = [];
    assert.equal(await runCli(args, io), 2, args.join(' '));
    assert.match(err.join('\n'), /abap-policy-lint: /);
  }
});

/** @param {string} content */
async function writeTmp(content) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'abap-tmp-')), 'file.json');
  await writeFile(file, content);
  return file;
}
