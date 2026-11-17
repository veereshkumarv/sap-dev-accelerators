import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createFinding, toSarif } from '@sapdx/findings';
import {
  BUNDLED_POLICY_DIR,
  NamingError,
  PolicyError,
  applyPolicy,
  isValidCapName,
  isoToday,
  loadPolicy,
  renderRapNames,
  resolvePolicyDir,
  runGate,
} from '../src/index.js';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sapdx-gate.js', import.meta.url));

/** Copies the repository policy into a temp dir and overrides selected files. */
async function policyDir(/** @type {Record<string, string>} */ overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sapdx-policy-'));
  await cp(BUNDLED_POLICY_DIR, dir, { recursive: true });
  for (const [name, content] of Object.entries(overrides)) await writeFile(path.join(dir, name), content);
  return dir;
}

const EXEMPTION = (/** @type {Record<string, string>} */ o = {}) => ({
  id: 'EXM-0001',
  rule: 'CAP-AUTH-001',
  object: 'CatalogService',
  owner: 'jane.doe',
  approver: 'john.architect',
  justification: 'Public catalogue read service approved by security.',
  created: '2026-11-01',
  expires: '2027-03-31',
  backlog: 'JIRA-1',
  ...o,
});
const exemptionsYaml = (/** @type {object[]} */ list) => JSON.stringify({ version: 1, exemptions: list });

test('repository policy is valid', async () => {
  const policy = await loadPolicy(BUNDLED_POLICY_DIR);
  assert.ok(policy.rules.length > 30);
  assert.equal(policy.ruleFor('CAP-SEC-001')?.severity, 'blocker');
  assert.equal(policy.ruleFor('ABAP-LINT-db_operation_in_loop'.toUpperCase())?.id, 'ABAP-LINT-*');
  assert.equal(policy.ruleFor('NOPE-1'), undefined);
  assert.ok(policy.naming && policy.forbiddenObjects);
});

test('loadPolicy reports schema, YAML and semantic errors', async () => {
  await assert.rejects(loadPolicy(await policyDir({ 'rules.yaml': 'version: 1\nrules:\n  - id: bad' })), PolicyError);
  await assert.rejects(loadPolicy(await policyDir({ 'rules.yaml': 'version: [' })), /Invalid YAML/);
  await assert.rejects(loadPolicy(path.join(tmpdir(), 'does-not-exist')), /Cannot read policy file/);

  const dup = 'version: 1\nrules:\n  - {id: A-1, title: aaa, severity: minor, tool: t}\n  - {id: A-1, title: aaa, severity: minor, tool: t}\n';
  await assert.rejects(loadPolicy(await policyDir({ 'rules.yaml': dup, 'exemptions.yaml': exemptionsYaml([]) })), /duplicate rule id A-1/);

  const bad = [
    EXEMPTION({ id: 'EXM-0002', approver: 'Jane.Doe' }),
    EXEMPTION({ id: 'EXM-0003', expires: '2026-10-01' }),
    EXEMPTION({ id: 'EXM-0004', expires: '2028-01-01' }),
    EXEMPTION({ id: 'EXM-0005', rule: 'NOPE-1' }),
    EXEMPTION({ id: 'EXM-0005' }),
    EXEMPTION({ id: 'EXM-0006', rule: 'POL-EXEMPT-001' }),
  ];
  const err = await loadPolicy(await policyDir({ 'exemptions.yaml': exemptionsYaml(bad) })).catch((e) => e);
  assert.ok(err instanceof PolicyError);
  for (const expected of ['approver must differ', 'expires before', '12-month', 'unknown rule NOPE-1', 'duplicate exemption id EXM-0005', 'cannot be exempted']) {
    assert.ok(err.details.some((/** @type {string} */ d) => d.includes(expected)), `missing: ${expected}`);
  }

  const noTarget = { ...EXEMPTION() };
  delete (/** @type {any} */ (noTarget).object);
  await assert.rejects(loadPolicy(await policyDir({ 'exemptions.yaml': exemptionsYaml([noTarget]) })), /Schema validation failed/);
});

test('resolvePolicyDir: explicit, env, upward search, bundled fallback', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sapdx-resolve-'));
  assert.equal(await resolvePolicyDir('p', root), path.join(root, 'p'));
  await mkdir(path.join(root, 'policy'));
  await writeFile(path.join(root, 'policy', 'rules.yaml'), '');
  await mkdir(path.join(root, 'a', 'b'), { recursive: true });
  assert.equal(await resolvePolicyDir(undefined, path.join(root, 'a', 'b')), path.join(root, 'policy'));
  process.env.SAPDX_POLICY_DIR = '/x/y';
  try {
    assert.equal(await resolvePolicyDir(undefined, root), '/x/y');
  } finally {
    delete process.env.SAPDX_POLICY_DIR;
  }
  assert.equal(await resolvePolicyDir(undefined, tmpdir()), BUNDLED_POLICY_DIR);
});

test('applyPolicy: catalog severity wins, disabled rules dropped, exemptions applied', async () => {
  const rules = `version: 1
rules:
  - {id: CAP-AUTH-001, title: auth, severity: critical, tool: t}
  - {id: CAP-LOG-001, title: log, severity: minor, tool: t, enabled: false}
  - {id: CAP-SEC-001, title: sec, severity: blocker, tool: t, baselineable: false}
  - {id: CAP-CFG-001, title: url, severity: major, tool: t}
  - {id: POL-EXEMPT-001, title: exp, severity: blocker, tool: policy, baselineable: false}
  - {id: POL-EXEMPT-002, title: unused, severity: minor, tool: policy}
`;
  const exemptions = [
    EXEMPTION(),
    EXEMPTION({ id: 'EXM-0002', rule: 'CAP-CFG-001', object: undefined, path: 'srv/legacy/**', created: '2026-01-01', expires: '2026-06-30' }),
    EXEMPTION({ id: 'EXM-0003', rule: 'CAP-CFG-001', object: 'Unused' }),
  ];
  const policy = await loadPolicy(await policyDir({ 'rules.yaml': rules, 'exemptions.yaml': exemptionsYaml(exemptions) }));
  const f = (/** @type {any} */ o) => createFinding({ severity: 'minor', message: 'm', tool: 't', ...o });
  const input = [
    f({ ruleId: 'CAP-AUTH-001', object: 'CatalogService', exemption: { id: 'X', owner: 'o', expires: '2099-01-01', justification: 'j' } }),
    f({ ruleId: 'CAP-AUTH-001', object: 'AdminService' }),
    f({ ruleId: 'CAP-LOG-001' }),
    f({ ruleId: 'CAP-SEC-001' }),
    f({ ruleId: 'CAP-CFG-001', location: { file: 'srv/legacy/a.js' } }),
    f({ ruleId: 'CAP-CFG-001' }),
    f({ ruleId: 'OTHER-1', severity: 'major' }),
  ];
  const { findings, expired, unused } = applyPolicy(input, policy, { today: '2026-11-17', unusedScope: ['CAP-'] });
  const [exempt, admin, sec, legacy, cfgNoLoc, other, expiredFinding, unusedFinding] = findings;
  assert.equal(findings.length, 8);
  assert.equal(exempt.exemption?.id, 'EXM-0001');
  assert.equal(exempt.severity, 'critical');
  assert.equal(admin.exemption, undefined);
  assert.equal(sec.severity, 'blocker');
  assert.equal(sec.baselineable, false);
  assert.equal(legacy.exemption, undefined, 'expired exemption must not exempt');
  assert.equal(cfgNoLoc.exemption, undefined);
  assert.equal(other.severity, 'major');
  assert.equal(expiredFinding.ruleId, 'POL-EXEMPT-001');
  assert.equal(expiredFinding.baselineable, false);
  assert.deepEqual(expired.map((e) => e.id), ['EXM-0002']);
  assert.equal(unusedFinding.ruleId, 'POL-EXEMPT-002');
  assert.deepEqual(unused.map((e) => e.id), ['EXM-0003']);
  assert.match(isoToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test('renderRapNames renders templates and enforces ABAP limits', async () => {
  const { naming } = await loadPolicy(BUNDLED_POLICY_DIR);
  const names = renderRapNames(naming, { area: 'SD', entity: 'ORDER' });
  assert.equal(names.table, 'ZSD_ORDER');
  assert.equal(names.draftTable, 'ZSD_ORDER_D');
  assert.equal(names.baseView, 'ZR_SD_ORDER');
  assert.equal(names.serviceBinding, 'ZUI_SD_ORDER_O4');
  assert.throws(() => renderRapNames(naming, { area: 'sd', entity: 'order' }), NamingError);
  assert.throws(() => renderRapNames(naming, { area: 'SD', entity: 'VERYLONGENTITYNAME' }), /table name .* \(max 16\)/);
  assert.throws(
    () => renderRapNames({ abap: { prefix: 'Y', rap: { table: 'Z{ENTITY}' } } }, { area: 'SD', entity: 'A' }),
    /lacks customer prefix Y/,
  );
});

test('isValidCapName checks CAP naming patterns', async () => {
  const { naming } = await loadPolicy(BUNDLED_POLICY_DIR);
  assert.equal(isValidCapName(naming, 'namespace', 'acme.sales'), true);
  assert.equal(isValidCapName(naming, 'namespace', 'my.bookshop'), false);
  assert.equal(isValidCapName(naming, 'service', 'OrderService'), true);
  assert.equal(isValidCapName(naming, 'service', 'orders'), false);
  assert.throws(() => isValidCapName(naming, /** @type {any} */ ('x'), 'a'), /No CAP naming pattern/);
});

test('runGate merges SARIF, applies policy, honours baseline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sapdx-gate-'));
  const sarifFile = path.join(dir, 'cap.sarif');
  const critical = createFinding({ ruleId: 'CAP-AUTH-001', severity: 'minor', message: 'no auth', tool: 't', object: 'AdminService' });
  await writeFile(sarifFile, JSON.stringify(toSarif([critical], { tool: { name: 't' } })));

  const failed = await runGate({ sarifFiles: [sarifFile], policyDir: BUNDLED_POLICY_DIR, out: path.join(dir, 'merged.sarif') });
  assert.equal(failed.exitCode, 1, 'catalog raises minor to critical');
  assert.match(failed.report, /GATE FAILED: 1 new/);
  const merged = JSON.parse(await readFile(path.join(dir, 'merged.sarif'), 'utf8'));
  assert.equal(merged.runs[0].results[0].properties.severity, 'critical');

  const baselineFile = path.join(dir, 'baseline.json');
  const written = await runGate({ sarifFiles: [sarifFile], policyDir: BUNDLED_POLICY_DIR, writeBaseline: baselineFile, today: '2026-11-17' });
  assert.equal(written.exitCode, 0);
  const passed = await runGate({ sarifFiles: [sarifFile], policyDir: BUNDLED_POLICY_DIR, baselineFile });
  assert.equal(passed.exitCode, 0);
  assert.match(passed.report, /accepted by baseline: 1/);

  await assert.rejects(runGate({ sarifFiles: [] }), /No SARIF files/);
});

test('sapdx-gate CLI exit codes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sapdx-cli-'));
  const clean = path.join(dir, 'clean.sarif');
  await writeFile(clean, JSON.stringify(toSarif([], { tool: { name: 't' } })));
  const ok = await run(process.execPath, [BIN, clean, '--policy', BUNDLED_POLICY_DIR]);
  assert.match(ok.stdout, /GATE PASSED/);
  const help = await run(process.execPath, [BIN, '--help']);
  assert.match(help.stdout, /Usage: sapdx-gate/);
  const usage = await run(process.execPath, [BIN]).catch((e) => e);
  assert.equal(usage.code, 2);
});
