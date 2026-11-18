/**
 * What: End-to-end tests of RAP generation: complete file set, clean-core properties of the
 *     generated sources, headers, abaplint verification (including mutation tests proving the
 *     verifier detects real errors), --deps resolution, file writing and the CLI contract.
 * Why: Proves that generated objects are complete, secure by default, syntactically valid for ABAP
 *     Cloud and self-documenting before anyone imports them into an SAP system.
 * If missing or unlinked: Generator regressions are only found during activation in a system.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { BUNDLED_POLICY_DIR, loadPolicy } from '@sapdx/policy';
import { OverwriteError, parseModelText, runCli, scaffold, verifyFiles, writeFiles } from '../src/index.js';
import { missingMarkers } from '../../../scripts/check-file-headers.js';

const policy = await loadPolicy(BUNDLED_POLICY_DIR);
const EXAMPLE = fileURLToPath(new URL('../examples/sales-order.yaml', import.meta.url));
const DEPS = fileURLToPath(new URL('./fixtures/deps', import.meta.url));
const example = parseModelText(await readFile(EXAMPLE, 'utf8'));
const { files } = scaffold(example, policy.naming);
const byPath = new Map(files.map((f) => [f.path, f.content]));
const content = (/** @type {string} */ p) => /** @type {string} */ (byPath.get(p));
const sources = files.filter((f) => /\.(abap|asddls|asdcls|asbdef|srvdsrv|asddlxs)$/.test(f.path));

test('generates the complete abapGit repository for root + child with draft', () => {
  assert.deepEqual(files.map((f) => f.path), [
    '.abapgit.xml',
    'README.md',
    'docs/files.md',
    'src/package.devc.xml',
    'src/zbp_r_sd_order.clas.abap',
    'src/zbp_r_sd_order.clas.locals_imp.abap',
    'src/zbp_r_sd_order.clas.testclasses.abap',
    'src/zbp_r_sd_order.clas.xml',
    'src/zc_sd_item.dcls.asdcls',
    'src/zc_sd_item.dcls.xml',
    'src/zc_sd_item.ddls.asddls',
    'src/zc_sd_item.ddls.xml',
    'src/zc_sd_item.ddlx.asddlxs',
    'src/zc_sd_item.ddlx.xml',
    'src/zc_sd_order.bdef.asbdef',
    'src/zc_sd_order.bdef.xml',
    'src/zc_sd_order.dcls.asdcls',
    'src/zc_sd_order.dcls.xml',
    'src/zc_sd_order.ddls.asddls',
    'src/zc_sd_order.ddls.xml',
    'src/zc_sd_order.ddlx.asddlxs',
    'src/zc_sd_order.ddlx.xml',
    'src/zr_sd_item.dcls.asdcls',
    'src/zr_sd_item.dcls.xml',
    'src/zr_sd_item.ddls.asddls',
    'src/zr_sd_item.ddls.xml',
    'src/zr_sd_order.bdef.asbdef',
    'src/zr_sd_order.bdef.xml',
    'src/zr_sd_order.dcls.asdcls',
    'src/zr_sd_order.dcls.xml',
    'src/zr_sd_order.ddls.asddls',
    'src/zr_sd_order.ddls.xml',
    'src/zsd_item.tabl.xml',
    'src/zsd_item_d.tabl.xml',
    'src/zsd_order.tabl.xml',
    'src/zsd_order_d.tabl.xml',
    'src/zui_sd_order.srvd.srvdsrv',
    'src/zui_sd_order.srvd.xml',
    'src/zui_sd_order_o4.srvb.xml',
  ]);
});

test('every source file has a What / Why / If-missing header; XML is documented in docs/files.md', () => {
  for (const f of files.filter((x) => !x.path.endsWith('.xml'))) assert.deepEqual(missingMarkers(f.path, f.content), [], f.path);
  const doc = content('docs/files.md');
  for (const f of files.filter((x) => x.path.endsWith('.xml'))) {
    assert.ok(doc.includes(`\`${f.path}\``), `${f.path} documented`);
    assert.doesNotMatch(f.content, /What:/, `${f.path} has no inline header`);
  }
  assert.match(doc, /No inline header:\*\* abapGit regenerates XML metadata/);
});

test('clean core: authorization on every view, behavior and service; no forbidden objects', () => {
  for (const f of files.filter((x) => x.path.endsWith('.ddls.asddls'))) {
    assert.match(f.content, /@AccessControl\.authorizationCheck: #CHECK/, f.path);
    assert.ok(byPath.has(f.path.replace('.ddls.asddls', '.dcls.asdcls')), `${f.path} has an access control`);
  }
  assert.match(content('src/zr_sd_order.dcls.asdcls'), /aspect pfcg_auth\( ZSD_ORDER, ACTVT = '03' \)/);
  assert.match(content('src/zc_sd_order.dcls.asdcls'), /inheriting conditions from entity ZR_SD_ORDER/);
  assert.match(content('src/zr_sd_order.bdef.asbdef'), /authorization master \( global \)/);
  assert.match(content('src/zr_sd_order.bdef.asbdef'), /authorization dependent by _Order/);
  assert.match(content('src/zbp_r_sd_order.clas.locals_imp.abap'), /AUTHORITY-CHECK OBJECT 'ZSD_ORDER' ID 'ACTVT' FIELD activity/);
  assert.match(content('src/zr_sd_order.bdef.asbdef'), /^strict \( 2 \);$/m);

  const forbidden = [...(policy.forbiddenObjects.tables ?? []), ...(policy.forbiddenObjects.functionModules ?? []), ...(policy.forbiddenObjects.classes ?? [])].map((o) => o.name);
  for (const f of sources) {
    for (const name of forbidden) assert.doesNotMatch(f.content, new RegExp(`\\b${name}\\b`, 'i'), `${f.path} uses ${name}`);
    assert.doesNotMatch(f.content, /CLIENT SPECIFIED|USING CLIENT|https?:\/\//i, f.path);
    for (const line of f.content.split('\n')) assert.ok(line.length <= 255, `${f.path}: line too long`);
  }
});

test('behavior: draft actions, Prepare runs all validations, unit tests cover positive and negative case', () => {
  const bdef = content('src/zr_sd_order.bdef.asbdef');
  for (const s of ['with draft;', 'draft table ZSD_ORDER_D', 'total etag LastChangedAt', 'draft action Activate optimized;', 'validation Item~validateMandatory;']) assert.ok(bdef.includes(s), s);
  const projection = content('src/zc_sd_order.bdef.asbdef');
  assert.match(projection, /use draft;[\s\S]*use action Edit;[\s\S]*use association _Item \{ create; with draft; \}/);
  const tests = content('src/zbp_r_sd_order.clas.testclasses.abap');
  assert.equal((tests.match(/METHODS \w+ FOR TESTING\./g) ?? []).length, 4, 'two tests per validated entity');
  assert.match(tests, /assert_equals\( exp = 3\s+act = lines\( failed-order \) \)/);
  assert.match(tests, /assert_equals\( exp = 2\s+act = lines\( failed-item \) \)/);
  assert.match(tests, /order_uuid = uuid_parent/, 'child test links to a parent key');
});

test('abaplint verification: no issues, normalisations and known gaps are reported', () => {
  const result = verifyFiles(files);
  assert.deepEqual(result.issues, []);
  assert.equal(result.objects, 20);
  assert.deepEqual(result.normalized.map((n) => `${n.gap}:${n.count}`).sort(), ['CLASS ... DEFINITION DEFERRED FOR TESTING:2', 'CREATE OBJECT ... FOR TESTING:2']);
  assert.ok(result.knownGaps.length > 0 && result.knownGaps.every((g) => /"(FAILED|REPORTED|MAPPED)"/.test(g.message)));
  assert.deepEqual(result.unverified, ['DCLS ZC_SD_ITEM', 'DCLS ZC_SD_ORDER', 'DCLS ZR_SD_ITEM', 'DCLS ZR_SD_ORDER', 'SRVB ZUI_SD_ORDER_O4', 'SRVD ZUI_SD_ORDER']);
});

for (const [name, file, mutate] of /** @type {Array<[string, string, (s: string) => string]>} */ ([
  ['CDS syntax error', 'src/zr_sd_order.ddls.asddls', (s) => s.replace('as select from', 'as selekt from')],
  ['behavior definition syntax error', 'src/zr_sd_order.bdef.asbdef', (s) => s.replace('lock master', 'lock mastr')],
  ['projection behavior syntax error', 'src/zc_sd_order.bdef.asbdef', (s) => s.replace('use update;', 'use update')],
  ['ABAP syntax error', 'src/zbp_r_sd_order.clas.locals_imp.abap', (s) => s.replace('result = xsdbool( sy-subrc = 0 ).', 'result = xsdbool( sy-subrc = 0 ')],
  ['unknown customer type', 'src/zbp_r_sd_order.clas.testclasses.abap', (s) => s.replace('TYPE STANDARD TABLE OF zsd_order WITH', 'TYPE STANDARD TABLE OF zsd_nope WITH')],
  ['metadata extension syntax error', 'src/zc_sd_order.ddlx.asddlxs', (s) => s.replace('annotate entity', 'annotate entitty')],
])) {
  test(`mutation: verifier detects a ${name}`, () => {
    const mutated = files.map((f) => (f.path === file ? { ...f, content: mutate(f.content) } : f));
    assert.notEqual(mutated.find((f) => f.path === file)?.content, content(file), 'mutation applied');
    assert.ok(verifyFiles(mutated).issues.some((i) => i.file === file), `issue reported for ${file}`);
  });
}

test('variant: no draft and no children', () => {
  const raw = { ...example, draft: false, children: [] };
  const generated = scaffold(raw, policy.naming).files;
  const paths = generated.map((f) => f.path);
  assert.ok(!paths.some((p) => p.endsWith('_d.tabl.xml')), 'no draft tables');
  const bdef = /** @type {string} */ (generated.find((f) => f.path === 'src/zr_sd_order.bdef.asbdef')?.content);
  assert.doesNotMatch(bdef, /draft|total etag/);
  assert.doesNotMatch(/** @type {string} */ (generated.find((f) => f.path.endsWith('locals_imp.abap'))?.content), /%state_area|%action-Edit/);
  assert.doesNotMatch(/** @type {string} */ (generated.find((f) => f.path === 'src/zr_sd_order.ddls.asddls')?.content), /composition/);
  assert.deepEqual(verifyFiles(generated).issues, []);
});

test('variant: child without mandatory fields has no handler; data elements need --deps to verify', () => {
  const raw = YAML.parse(YAML.stringify(example));
  raw.children[0].fields = raw.children[0].fields.map((/** @type {any} */ f) => ({ ...f, mandatory: false }));
  raw.root.fields.push({ name: 'CODE', dataElement: 'ZDE_CODE', mandatory: true, sample: "'A1'" }, { name: 'AMOUNT', type: 'dec', length: 10, decimals: 2 }, { name: 'AT_TIME', type: 'tims' });
  const generated = scaffold(raw, policy.naming).files;
  const locals = /** @type {string} */ (generated.find((f) => f.path.endsWith('locals_imp.abap'))?.content);
  assert.doesNotMatch(locals, /lhc_item/);
  assert.doesNotMatch(/** @type {string} */ (generated.find((f) => f.path === 'src/zr_sd_order.bdef.asbdef')?.content), /Item~validateMandatory/);
  assert.match(/** @type {string} */ (generated.find((f) => f.path.endsWith('testclasses.abap'))?.content), /code = 'A1'/);
  assert.ok(verifyFiles(generated).issues.some((i) => /ZDE_CODE/.test(i.message)), 'unknown data element reported without deps');
});

test('generation is deterministic and pure', () => {
  const again = scaffold(parseModelText(YAML.stringify(example)), policy.naming).files;
  assert.deepEqual(again, files);
});

test('writeFiles refuses to overwrite unless forced', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rap-write-'));
  await writeFiles(files, dir);
  assert.equal(await readFile(path.join(dir, 'src/zr_sd_order.ddls.asddls'), 'utf8'), content('src/zr_sd_order.ddls.asddls'));
  await assert.rejects(writeFiles(files, dir), (err) => err instanceof OverwriteError && err.files.length === files.length);
  await writeFile(path.join(dir, 'README.md'), 'changed');
  await writeFiles(files, dir, { force: true });
  assert.equal(await readFile(path.join(dir, 'README.md'), 'utf8'), content('README.md'));
});

test('CLI: help, usage errors, model errors, verification failure, deps, success and overwrite', async () => {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const io = { stdout: (/** @type {string} */ s) => out.push(s), stderr: (/** @type {string} */ s) => err.push(s) };
  const dir = await mkdtemp(path.join(tmpdir(), 'rap-cli-'));
  const p = BUNDLED_POLICY_DIR;

  assert.equal(await runCli(['--help'], io), 0);
  assert.match(out.join('\n'), /^Usage: rap-scaffold/);
  assert.equal(await runCli([], io), 2);
  assert.equal(await runCli(['--bogus'], io), 2);

  const badModel = path.join(dir, 'bad.yaml');
  await writeFile(badModel, 'area: x');
  assert.equal(await runCli(['--model', badModel, '--out', path.join(dir, 'x'), '--policy', p], io), 2);
  assert.match(err.join('\n'), /Invalid RAP model/);

  const depModel = path.join(dir, 'dep.yaml');
  await writeFile(depModel, YAML.stringify({ ...example, children: [], root: { ...example.root, fields: [...example.root.fields, { name: 'CODE', dataElement: 'ZDE_CODE', mandatory: true, sample: "'A1'" }] } }));
  err.length = 0;
  assert.equal(await runCli(['--model', depModel, '--out', path.join(dir, 'dep'), '--policy', p], io), 1);
  assert.match(err.join('\n'), /verification failed .* nothing was written/);
  await assert.rejects(readdir(path.join(dir, 'dep')));
  assert.equal(await runCli(['--model', depModel, '--out', path.join(dir, 'dep'), '--policy', p, '--deps', DEPS], io), 0);

  out.length = 0;
  const target = path.join(dir, 'out');
  assert.equal(await runCli(['--model', EXAMPLE, '--out', target, '--policy', p], io), 0);
  assert.match(out.join('\n'), /Verified 20 objects[\s\S]*Generated ZR_SD_ORDER: 39 files/);
  assert.match(out.join('\n'), /note: .*normalised for abaplint/);
  assert.equal(await runCli(['--model', EXAMPLE, '--out', target, '--policy', p], io), 2);
  assert.equal(await runCli(['--model', EXAMPLE, '--out', target, '--policy', p, '--force', '--no-verify'], io), 0);
});
