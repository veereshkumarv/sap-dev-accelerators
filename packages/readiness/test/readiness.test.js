/**
 * What: Tests for sapdx-readiness: the committed Green example for DEV/QA/PROD, every RDY-* check
 *     in its pass / warn / fail / missing states (by mutating a copy of the example), the decision
 *     rule, the three report formats and the CLI (exit codes, --out, --amber-exit, init).
 * Why: A wrong readiness decision either blocks a valid release or lets a broken one through; each
 *     criterion is proven separately and end to end on real evidence.
 * If missing or unlinked: The package fails the workspace guardrail and readiness regressions go
 *     unnoticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createBaseline, createFinding, fromSarif, toSarif } from '@sapdx/findings';
import { BUNDLED_POLICY_DIR, applyPolicy, loadPolicy } from '@sapdx/policy';
import { assess, decide, junit, lcovPercent, credentialPaths, runCli, toJson, toMarkdown, toText, EVIDENCE_TEMPLATE } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../examples/evidence/', import.meta.url));
const REFERENCE_APP = fileURLToPath(new URL('../../../reference-apps/sales-orders/', import.meta.url));
const RAP_EXAMPLE = fileURLToPath(new URL('../../rap-scaffold/examples/out/', import.meta.url));
const TODAY = '2026-11-20';

/** Copy of the Green example with an absolute project path; returns the folder. */
async function example() {
  const dir = await mkdtemp(path.join(tmpdir(), 'sapdx-rdy-'));
  await cp(EXAMPLE, dir, { recursive: true });
  await manifest(dir, (m) => ({ ...m, project: REFERENCE_APP }));
  return dir;
}

/**
 * @param {string} dir
 * @param {(m: any) => any} change
 */
async function manifest(dir, change) {
  const file = path.join(dir, 'evidence.yaml');
  await writeFile(file, YAML.stringify(change(YAML.parse(await readFile(file, 'utf8')))));
}

/**
 * @param {string} dir
 * @param {string} target
 * @param {Partial<import('../src/readiness.js').AssessOptions>} [extra]
 */
const run = (dir, target, extra = {}) => assess({ evidenceDir: dir, target, today: TODAY, ...extra });

/**
 * @param {Awaited<ReturnType<typeof assess>>} a
 * @param {string} id
 */
const check = (a, id) => {
  const c = a.checks.find((x) => x.id === id);
  assert.ok(c, `check ${id} reported`);
  return c;
};

/**
 * @param {number} tests
 * @param {{ failures?: number, skipped?: number }} [o]
 */
function junitXml(tests, { failures = 0, skipped = 0 } = {}) {
  const cases = Array.from({ length: tests }, (_, i) =>
    i < failures ? `<testcase name="t${i}"><failure message="boom"/></testcase>` : i < failures + skipped ? `<testcase name="t${i}"><skipped/></testcase>` : `<testcase name="t${i}"/>`,
  );
  return `<?xml version="1.0"?><testsuites><testsuite name="s">${cases.join('')}</testsuite></testsuites>`;
}

/** @param {Array<{ ruleId: string, severity: import('@sapdx/findings').Severity, file?: string }>} items */
function sarif(items) {
  const findings = items.map((i) => createFinding({ ruleId: i.ruleId, severity: i.severity, message: `${i.ruleId} found`, tool: 'cap-policy-lint', location: { file: i.file ?? 'srv/service.js', line: 3 } }));
  return JSON.stringify(toSarif(findings, { tool: { name: 'cap-policy-lint' } }));
}

test('committed example evidence is GREEN for DEV, QA and PROD', async () => {
  const dir = await example();
  for (const target of ['DEV', 'qa', 'PROD']) {
    const a = await run(dir, target);
    assert.equal(a.decision, 'GREEN', `${target}: ${a.reasons.join('; ')}`);
    assert.deepEqual(a.reasons, []);
  }
  const prod = await run(dir, 'PROD');
  assert.equal(prod.target, 'PROD');
  assert.deepEqual(prod.release, { version: '1.0.0', changeRecord: 'CHG0012345', project: REFERENCE_APP });
  assert.equal(check(prod, 'RDY-TESTS').detail, '15 test(s), 0 failed, 0 error(s), 0 skipped.');
  assert.equal(check(prod, 'RDY-CONTRACT').detail, '22 contract test(s), 0 failed, 0 error(s), 0 skipped.');
  assert.equal(check(prod, 'RDY-TRANSPORT').status, 'skipped');
  assert.equal(check(prod, 'RDY-CONTRACT').mandatory, true);
  const dev = await run(dir, 'DEV');
  assert.equal(check(dev, 'RDY-CONTRACT').mandatory, false);
  assert.equal(check(dev, 'RDY-CONTRACT').status, 'pass');
});

test('decision rule: Red for missing mandatory or failed Blocker/Critical, Amber for warnings or failed Major', () => {
  /** @param {any} status @param {any} severity */
  const c = (status, severity = 'critical') => ({ id: 'RDY-X', title: 'x', severity, mandatory: true, status, detail: 'd', evidence: [] });
  assert.deepEqual(decide([c('pass'), c('n/a'), c('skipped')]), { decision: 'GREEN', reasons: [] });
  assert.equal(decide([c('warn')]).decision, 'AMBER');
  assert.equal(decide([c('fail', 'major')]).decision, 'AMBER');
  assert.equal(decide([c('fail', 'minor')]).decision, 'AMBER');
  assert.equal(decide([c('fail', 'critical')]).decision, 'RED');
  assert.equal(decide([c('fail', 'blocker'), c('warn')]).reasons.length, 2);
  assert.equal(decide([c('missing')]).decision, 'RED');
  assert.equal(decide([c('pass')], ['x.xml: bad']).decision, 'RED');
  // Many passes never outweigh one critical failure.
  assert.equal(decide([...Array(50)].map(() => c('pass')).concat([c('fail')])).decision, 'RED');
});

test('RDY-FINDINGS: new Blocker/Critical is Red, baseline accepts existing, new Major is Amber, no SARIF is missing', async () => {
  const dir = await example();
  await writeFile(path.join(dir, 'cap-policy.sarif'), sarif([{ ruleId: 'CAP-AUTH-001', severity: 'critical' }, { ruleId: 'CAP-PERF-001', severity: 'major' }]));
  let a = await run(dir, 'DEV');
  assert.equal(a.decision, 'RED');
  assert.match(check(a, 'RDY-FINDINGS').detail, /1 new Blocker\/Critical finding\(s\): CAP-AUTH-001 \(srv\/service\.js:3\)/);

  const policy = await loadPolicy(BUNDLED_POLICY_DIR);
  const raw = fromSarif(JSON.parse(await readFile(path.join(dir, 'cap-policy.sarif'), 'utf8')));
  const accepted = applyPolicy(raw.filter((f) => f.ruleId === 'CAP-AUTH-001'), policy, { today: TODAY }).findings;
  const baselineFile = path.join(dir, '..', `${path.basename(dir)}-baseline.json`);
  await writeFile(baselineFile, JSON.stringify(createBaseline(accepted, { createdAt: TODAY })));
  a = await run(dir, 'DEV', { baselineFile });
  assert.equal(check(a, 'RDY-FINDINGS').status, 'warn');
  assert.match(check(a, 'RDY-FINDINGS').detail, /1 new Major finding\(s\); 2 finding\(s\), 1 new, 1 accepted by baseline/);
  assert.equal(a.decision, 'AMBER');

  await writeFile(path.join(dir, 'cap-policy.sarif'), sarif(Array.from({ length: 4 }, () => ({ ruleId: 'CAP-SEC-001', severity: 'blocker' })).map((f, i) => ({ ...f, file: `srv/f${i}.js` }))));
  assert.match(check(await run(dir, 'DEV'), 'RDY-FINDINGS').detail, /4 new Blocker\/Critical finding\(s\): .*, \.\.\./);

  await rm(path.join(dir, 'cap-policy.sarif'));
  a = await run(dir, 'DEV');
  assert.equal(check(a, 'RDY-FINDINGS').status, 'missing');
  assert.equal(a.decision, 'RED');
  assert.match(a.reasons[0], /RDY-FINDINGS mandatory evidence missing/);
});

test('RDY-TESTS and RDY-CONTRACT: failures Red, skipped Amber, too few executed Red, missing contract is skipped below PROD', async () => {
  const dir = await example();
  await writeFile(path.join(dir, 'junit.xml'), junitXml(5, { failures: 1 }));
  assert.equal((await run(dir, 'DEV')).decision, 'RED');

  await writeFile(path.join(dir, 'junit.xml'), junitXml(5, { skipped: 2 }));
  let a = await run(dir, 'DEV');
  assert.equal(check(a, 'RDY-TESTS').status, 'warn');
  assert.equal(a.decision, 'AMBER');

  await writeFile(path.join(dir, 'junit.xml'), junitXml(1, { skipped: 1 }));
  assert.match(check(await run(dir, 'DEV'), 'RDY-TESTS').detail, /at least 1 executed test\(s\) required/);

  await rm(path.join(dir, 'contract'), { recursive: true });
  await writeFile(path.join(dir, 'junit.xml'), junitXml(3));
  a = await run(dir, 'QA');
  assert.equal(check(a, 'RDY-CONTRACT').status, 'skipped');
  assert.equal(a.decision, 'GREEN');
  a = await run(dir, 'PROD');
  assert.equal(check(a, 'RDY-CONTRACT').status, 'missing');
  assert.equal(a.decision, 'RED');

  await mkdir(path.join(dir, 'newman'));
  await writeFile(path.join(dir, 'newman', 'results.xml'), junitXml(4, { failures: 2 }));
  assert.match(check(await run(dir, 'PROD'), 'RDY-CONTRACT').detail, /4 contract test\(s\), 2 failed/);
});

test('JUnit parsing: nested suites, single testsuite root, errors, and non-JUnit XML ignored', async () => {
  assert.deepEqual(junit('a.xml', { testsuites: { testsuite: [{ testcase: { error: '' }, testsuite: { testcase: [{}, { skipped: '' }] } }, 'junk'] } }), { file: 'a.xml', tests: 3, failures: 0, errors: 1, skipped: 1 });
  assert.deepEqual(junit('b.xml', { testsuite: { testcase: [{ failure: '' }, {}] } }), { file: 'b.xml', tests: 2, failures: 1, errors: 0, skipped: 0 });
  assert.equal(junit('c.xml', { project: {} }), undefined);
  assert.deepEqual(junit('d.xml', { testsuites: '' }), { file: 'd.xml', tests: 0, failures: 0, errors: 0, skipped: 0 });

  const dir = await example();
  await writeFile(path.join(dir, 'pom.xml'), '<?xml version="1.0"?><project/>');
  const a = await run(dir, 'DEV');
  assert.deepEqual(check(a, 'RDY-TESTS').evidence, ['junit.xml']);
  assert.equal(a.decision, 'GREEN');
});

test('RDY-COVERAGE: below minimum Red, below target Amber; lcov and coverage-summary.json', async () => {
  const dir = await example();
  await writeFile(path.join(dir, 'lcov.info'), 'SF:a.js\nLF:100\nLH:70\nend_of_record\n');
  // Not mandatory for DEV, but evaluated: 70 % meets the DEV minimum (60 %) and misses its target (80 %).
  assert.equal(check(await run(dir, 'DEV'), 'RDY-COVERAGE').status, 'warn');
  let a = await run(dir, 'QA');
  assert.equal(check(a, 'RDY-COVERAGE').status, 'fail');
  assert.equal(a.decision, 'RED');

  await rm(path.join(dir, 'lcov.info'));
  await writeFile(path.join(dir, 'coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 87.5 } } }));
  a = await run(dir, 'PROD');
  assert.equal(check(a, 'RDY-COVERAGE').status, 'warn');
  assert.match(check(a, 'RDY-COVERAGE').detail, /87\.5 % meets the minimum \(80 %\) but is below the target of 90 %/);
  assert.equal(a.decision, 'AMBER');

  await writeFile(path.join(dir, 'coverage-summary.json'), JSON.stringify({ total: {} }));
  assert.equal(check(await run(dir, 'QA'), 'RDY-COVERAGE').status, 'missing');

  assert.equal(lcovPercent('TN:\n'), 0);
  assert.equal(lcovPercent('LF:3\nLH:1\nLF:3\nLH:3\n'), 66.67);
});

test('RDY-DEPS: high/critical Red, moderate Amber', async () => {
  const dir = await example();
  const audit = (/** @type {object} */ v) => writeFile(path.join(dir, 'npm-audit.json'), JSON.stringify({ metadata: { vulnerabilities: v } }));
  await audit({ high: 2, critical: 0, moderate: 1 });
  let a = await run(dir, 'QA');
  assert.equal(a.decision, 'RED');
  assert.match(check(a, 'RDY-DEPS').detail, /Vulnerable dependencies: 2 high\./);
  await audit({ moderate: 3 });
  a = await run(dir, 'QA');
  assert.equal(a.decision, 'AMBER');
  await writeFile(path.join(dir, 'npm-audit.json'), '{}');
  assert.equal(check(await run(dir, 'QA'), 'RDY-DEPS').status, 'pass');
});

test('RDY-SECRETS: any leak is Red (SARIF or gitleaks JSON)', async () => {
  const dir = await example();
  const leaks = JSON.parse(await readFile(path.join(dir, 'gitleaks.sarif'), 'utf8'));
  leaks.runs[0].results = [{ ruleId: 'generic-api-key', message: { text: 'key' } }];
  await writeFile(path.join(dir, 'gitleaks.sarif'), JSON.stringify(leaks));
  const a = await run(dir, 'QA');
  assert.equal(check(a, 'RDY-SECRETS').severity, 'blocker');
  assert.equal(a.decision, 'RED');
  // The secret scan is not mixed into the findings gate.
  assert.equal(check(a, 'RDY-FINDINGS').status, 'pass');

  await rm(path.join(dir, 'gitleaks.sarif'));
  await writeFile(path.join(dir, 'gitleaks-report.json'), JSON.stringify([{ RuleID: 'aws-access-token' }, { RuleID: 'x' }]));
  assert.match(check(await run(dir, 'QA'), 'RDY-SECRETS').detail, /^2 secret\(s\) detected/);
  await writeFile(path.join(dir, 'gitleaks-report.json'), '{}');
  assert.equal(check(await run(dir, 'QA'), 'RDY-SECRETS').status, 'pass');
});

test('RDY-DESCRIPTOR: mta.yaml structure, literal credentials, version, abapGit repositories', async () => {
  const dir = await example();
  const project = path.join(dir, 'project');
  await mkdir(project);
  await manifest(dir, (m) => ({ ...m, project: 'project' }));
  const mta = (/** @type {string} */ text) => writeFile(path.join(project, 'mta.yaml'), text);

  assert.match(check(await run(dir, 'QA'), 'RDY-DESCRIPTOR').detail, /No deployment descriptor \(mta.yaml or .abapgit.xml\) in project/);
  await mta('ID: [unclosed');
  assert.match(check(await run(dir, 'QA'), 'RDY-DESCRIPTOR').detail, /^mta.yaml is not valid YAML/);
  await mta('ID: app\n');
  assert.equal(check(await run(dir, 'QA'), 'RDY-DESCRIPTOR').detail, 'mta.yaml: _schema-version missing; version missing; no modules.');
  await mta(['_schema-version: 3.3.0', 'ID: app', 'version: 2.0.0', 'modules:', '  - name: srv', '    type: nodejs', '    properties:', '      password: s3cr3t', '      token: ${generated-password}', '  - path: x', 'resources:', '  - name: dest', '    parameters: { config: { clientsecret: abc } }'].join('\n'));
  const a = await run(dir, 'QA');
  assert.equal(
    check(a, 'RDY-DESCRIPTOR').detail,
    'mta.yaml: module ? without name or type; literal credential at modules[0].properties.password; literal credential at resources[0].parameters.config.clientsecret; version 2.0.0 differs from release version 1.0.0.',
  );
  assert.equal(a.decision, 'RED');

  await rm(path.join(project, 'mta.yaml'));
  await writeFile(path.join(project, '.abapgit.xml'), '<?xml version="1.0"?><asx:abap><asx:values><DATA/></asx:values></asx:abap>');
  assert.match(check(await run(dir, 'QA'), 'RDY-DESCRIPTOR').detail, /lacks MASTER_LANGUAGE/);

  await manifest(dir, (m) => ({ ...m, project: RAP_EXAMPLE }));
  assert.equal(check(await run(dir, 'QA'), 'RDY-DESCRIPTOR').detail, 'abapGit repository (language E, folder /src/).');
  assert.equal(check(await run(dir, 'PROD'), 'RDY-PROD-CONFIG').status, 'n/a');

  await manifest(dir, ({ project: _p, ...m }) => m);
  const noProject = await run(dir, 'PROD');
  assert.equal(check(noProject, 'RDY-DESCRIPTOR').status, 'missing');
  assert.equal(check(noProject, 'RDY-PROD-CONFIG').status, 'missing');

  assert.deepEqual(credentialPaths({ a: [{ pwd: 1 }, { apikey: '${x}' }], b: null }), ['a[0].pwd']);
});

test('RDY-API-COMPAT: breaking changes need a major version bump', async () => {
  const dir = await example();
  const diff = (/** @type {object} */ r) => writeFile(path.join(dir, 'api-diff.json'), JSON.stringify({ tool: 'odata-diff', ...r }));
  await diff({ breaking: 2, additive: 0 });
  let a = await run(dir, 'QA');
  assert.match(check(a, 'RDY-API-COMPAT').detail, /2 breaking API change\(s\) released as new major version 1.0.0 \(was 0.9.0\)/);

  await manifest(dir, (m) => ({ ...m, version: '1.1.0', previousVersion: '1.0.0' }));
  a = await run(dir, 'QA');
  assert.match(check(a, 'RDY-API-COMPAT').detail, /2 breaking API change\(s\) but version 1.1.0 is not a major bump over 1.0.0/);
  assert.equal(a.decision, 'RED');

  await manifest(dir, (m) => ({ ...m, version: '2.0.0' }));
  a = await run(dir, 'QA');
  assert.equal(check(a, 'RDY-API-COMPAT').status, 'pass');
  assert.equal(check(a, 'RDY-DESCRIPTOR').status, 'fail'); // mta.yaml still says 1.0.0

  await manifest(dir, ({ previousVersion: _p, ...m }) => m);
  assert.match(check(await run(dir, 'QA'), 'RDY-API-COMPAT').detail, /must state version and previousVersion/);

  await diff({ breaking: 0, additive: 3 });
  assert.equal(check(await run(dir, 'QA'), 'RDY-API-COMPAT').detail, '3 additive change(s), no breaking changes.');
  await diff({});
  assert.equal(check(await run(dir, 'QA'), 'RDY-API-COMPAT').detail, 'No API changes.');
  await rm(path.join(dir, 'api-diff.json'));
  assert.equal(check(await run(dir, 'QA'), 'RDY-API-COMPAT').status, 'missing');
});

test('manifest checks: database migration, rollback, change record, transports', async () => {
  const dir = await example();
  await manifest(dir, (m) => ({ ...m, dbMigration: { destructive: true } }));
  let a = await run(dir, 'DEV');
  assert.equal(check(a, 'RDY-DB-MIGRATION').detail, 'Destructive database change declared without a migration plan.');
  assert.equal(a.decision, 'RED'); // evaluated although not mandatory, and critical
  await manifest(dir, (m) => ({ ...m, dbMigration: { destructive: true, plan: 'migration.md' } }));
  assert.equal(check(await run(dir, 'DEV'), 'RDY-DB-MIGRATION').detail, 'Migration plan migration.md not found.');
  await writeFile(path.join(dir, 'migration.md'), '# Drop column NOTE\nExport, drop, verify.\n');
  assert.equal(check(await run(dir, 'DEV'), 'RDY-DB-MIGRATION').status, 'pass');
  await manifest(dir, ({ dbMigration: _d, ...m }) => m);
  assert.equal(check(await run(dir, 'DEV'), 'RDY-DB-MIGRATION').status, 'skipped');

  await writeFile(path.join(dir, 'rollback.md'), '  \n');
  a = await run(dir, 'PROD');
  assert.equal(check(a, 'RDY-ROLLBACK').detail, 'Rollback procedure rollback.md is empty.');
  assert.equal(a.decision, 'AMBER'); // RDY-ROLLBACK is Major
  await manifest(dir, ({ rollback: _r, ...m }) => m);
  assert.equal((await run(dir, 'PROD')).decision, 'RED'); // ... but mandatory for PROD

  await manifest(dir, (m) => ({ ...m, rollback: 'rollback.md', changeRecord: 'TICKET-1' }));
  await writeFile(path.join(dir, 'rollback.md'), 'Redeploy 0.9.0.\n');
  a = await run(dir, 'QA');
  assert.match(check(a, 'RDY-CHANGE-RECORD').detail, /"TICKET-1" does not match/);
  assert.equal(a.decision, 'AMBER');
  await manifest(dir, ({ changeRecord: _c, ...m }) => m);
  assert.equal(check(await run(dir, 'QA'), 'RDY-CHANGE-RECORD').status, 'missing');

  await manifest(dir, (m) => ({ ...m, changeRecord: 'CHG0012345', transports: { targetSystem: 'Q01', requests: [{ id: 'S4DK900123', predecessors: [{ id: 'S4DK900100', importedIn: ['D01'] }, { id: 'S4DK900101', importedIn: ['Q01'] }] }] } }));
  a = await run(dir, 'QA');
  assert.equal(check(a, 'RDY-TRANSPORT').detail, 'Predecessors not imported in Q01: S4DK900123 needs S4DK900100.');
  assert.equal(a.decision, 'RED');
  await manifest(dir, (m) => ({ ...m, transports: { requests: [{ id: 'S4DK900123', predecessors: [{ id: 'S4DK900100', importedIn: ['QA'] }] }, { id: 'S4DK900124' }] } }));
  assert.equal(check(await run(dir, 'QA'), 'RDY-TRANSPORT').detail, '2 transport request(s); all predecessors imported in QA.');
});

test('RDY-PROD-CONFIG: development auth, SQLite and inline URLs in the production profile', async () => {
  const dir = await example();
  const project = path.join(dir, 'project');
  await mkdir(project);
  await cp(path.join(REFERENCE_APP, 'mta.yaml'), path.join(project, 'mta.yaml'));
  await manifest(dir, (m) => ({ ...m, project: 'project' }));
  const pkg = (/** @type {object} */ cds) => writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'p', dependencies: { '@sap/cds': '^10' }, cds }));

  await pkg({ requires: { auth: 'mocked' } });
  let a = await run(dir, 'PROD');
  assert.match(check(a, 'RDY-PROD-CONFIG').detail, /authentication in production is "mocked"/);
  assert.equal(a.decision, 'RED');

  await pkg({ requires: { '[production]': { auth: { kind: 'ias' }, db: { kind: 'sqlite' }, API_BP: { kind: 'odata-v2', credentials: { url: 'https://s4.example.com' } } } } });
  assert.equal(check(await run(dir, 'PROD'), 'RDY-PROD-CONFIG').detail, 'Production profile: database in production is "sqlite"; remote service API_BP uses an inline URL instead of a destination.');

  await pkg({});
  assert.match(check(await run(dir, 'PROD'), 'RDY-PROD-CONFIG').detail, /"not configured"/);

  await writeFile(path.join(project, '.cdsrc.json'), JSON.stringify({ requires: { '[production]': { auth: 'xsuaa', db: 'hana' } } }));
  a = await run(dir, 'PROD');
  assert.equal(check(a, 'RDY-PROD-CONFIG').detail, 'Production profile uses xsuaa authentication and hana.');
  assert.deepEqual(check(a, 'RDY-PROD-CONFIG').evidence, ['project/package.json', 'project/.cdsrc.json']);

  await rm(path.join(project, 'package.json'));
  await rm(path.join(project, '.cdsrc.json'));
  assert.equal(check(await run(dir, 'PROD'), 'RDY-PROD-CONFIG').status, 'n/a');
});

test('unreadable evidence is Red; configuration errors are thrown', async () => {
  const dir = await example();
  await writeFile(path.join(dir, 'broken.sarif'), '{ not json');
  const a = await run(dir, 'DEV');
  assert.equal(a.decision, 'RED');
  assert.match(a.problems[0], /^broken.sarif: /);
  assert.match(a.reasons[0], /^Unreadable evidence: broken.sarif/);

  await assert.rejects(run(dir, 'UAT'), /Unknown target UAT; readiness.yaml defines DEV, QA, PROD/);
  await assert.rejects(run(path.join(dir, 'nope'), 'DEV'), /Evidence folder not found/);

  const policyDir = await mkdtemp(path.join(tmpdir(), 'sapdx-rdy-policy-'));
  await cp(path.join(BUNDLED_POLICY_DIR, 'rules.yaml'), path.join(policyDir, 'rules.yaml'));
  await assert.rejects(run(dir, 'DEV', { policyDir }), /No readiness.yaml in policy directory/);

  // A rule disabled in the catalog is not evaluated at all.
  const rules = YAML.parse(await readFile(path.join(policyDir, 'rules.yaml'), 'utf8'));
  rules.rules.find((/** @type {any} */ r) => r.id === 'RDY-TRANSPORT').enabled = false;
  await writeFile(path.join(policyDir, 'rules.yaml'), YAML.stringify(rules));
  await cp(path.join(BUNDLED_POLICY_DIR, 'readiness.yaml'), path.join(policyDir, 'readiness.yaml'));
  await rm(path.join(dir, 'broken.sarif'));
  const b = await run(dir, 'DEV', { policyDir });
  assert.equal(b.checks.some((c) => c.id === 'RDY-TRANSPORT'), false);
  assert.equal(b.decision, 'GREEN');
});

test('reports: text, JSON and Markdown carry the same decision', async () => {
  const dir = await example();
  await writeFile(path.join(dir, 'junit.xml'), junitXml(3, { skipped: 1 }));
  const a = await run(dir, 'PROD');
  const text = toText(a);
  assert.match(text, /^Release readiness for PROD - version 1.0.0 \(CHG0012345\)/);
  assert.match(text, /WARN {4}RDY-TESTS {9}\* 3 test\(s\)/);
  assert.match(text, /Reasons:\n {2}- RDY-TESTS warning/);
  assert.match(text, /DECISION: AMBER$/);
  const json = toJson(a);
  assert.equal(json.decision, 'AMBER');
  assert.equal(json.checks.length, 13);
  assert.deepEqual(Object.keys(json.checks[0]), ['id', 'title', 'severity', 'mandatory', 'status', 'detail', 'evidence']);
  const md = toMarkdown(a);
  assert.match(md, /^## Release readiness: 🟠 AMBER/);
  assert.match(md, /\| RDY-TESTS Unit or integration tests failing or missing \| WARN \| critical \| yes \|/);
  assert.match(md, /### Reasons/);

  const green = await run(await example(), 'DEV');
  assert.doesNotMatch(toText(green), /Reasons:/);
  assert.doesNotMatch(toMarkdown(green), /### Reasons/);
  const bare = { ...green, release: {} };
  assert.match(toText(bare), /^Release readiness for DEV\n/);
  assert.match(toMarkdown(bare), /Target \*\*DEV\*\*, assessed/);
});

/** @param {string[]} args @param {string} [cwd] */
async function cli(args, cwd) {
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ const err = [];
  const code = await runCli(args, { stdout: (s) => out.push(s), stderr: (s) => err.push(s), ...(cwd ? { cwd } : {}) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('CLI: exit codes 0 Green / 1 Red / 3 Amber (or --amber-exit), formats and --out', async () => {
  const dir = await example();
  let r = await cli(['check', '--evidence', dir, '--target', 'PROD', '--today', TODAY]);
  assert.equal(r.code, 0);
  assert.match(r.out, /DECISION: GREEN$/);

  r = await cli(['check', '--evidence', dir, '--target', 'PROD', '--format', 'json']);
  assert.equal(JSON.parse(r.out).decision, 'GREEN');

  await writeFile(path.join(dir, 'junit.xml'), junitXml(3, { skipped: 1 }));
  r = await cli(['check', '--evidence', dir, '--target', 'QA']);
  assert.equal(r.code, 3);
  r = await cli(['check', '--evidence', dir, '--target', 'QA', '--amber-exit', '0', '--format', 'markdown', '--out', 'reports/readiness.md'], dir);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'DECISION: AMBER for QA (0 failed or missing check(s)). Report written to reports/readiness.md.');
  assert.match(await readFile(path.join(dir, 'reports', 'readiness.md'), 'utf8'), /^## Release readiness: 🟠 AMBER/);

  await writeFile(path.join(dir, 'junit.xml'), junitXml(3, { failures: 1 }));
  const baseline = path.join(dir, 'baseline.json');
  await writeFile(baseline, JSON.stringify(createBaseline([], { createdAt: TODAY })));
  r = await cli(['check', '--evidence', '.', '--target', 'dev', '--baseline', 'baseline.json', '--policy', BUNDLED_POLICY_DIR], dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL {4}RDY-TESTS/);
});

test('CLI: usage and configuration errors exit 2; --help; init writes the manifest template once', async () => {
  const dir = await example();
  assert.equal((await cli(['--help'])).code, 0);
  assert.match((await cli(['-h'])).out, /^Usage:/);
  for (const [args, message] of /** @type {Array<[string[], RegExp]>} */ ([
    [[], /Missing command/],
    [['deploy'], /Unknown command: deploy/],
    [['check', 'extra'], /Unexpected argument: extra/],
    [['check', '--target', 'QA'], /--evidence <dir> is required/],
    [['check', '--evidence', dir], /--target <DEV\|QA\|PROD> is required/],
    [['check', '--evidence', dir, '--target', 'QA', '--format', 'sarif'], /Unknown format: sarif/],
    [['check', '--evidence', dir, '--target', 'QA', '--today', '20.11.2026'], /--today must be YYYY-MM-DD/],
    [['check', '--evidence', dir, '--target', 'QA', '--amber-exit', 'x'], /--amber-exit must be an integer 0-255/],
    [['check', '--evidence', dir, '--target', 'UAT'], /Unknown target UAT/],
    [['check', '--bogus'], /Unknown option '--bogus'/],
  ])) {
    const r = await cli(args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, message);
  }

  const work = await mkdtemp(path.join(tmpdir(), 'sapdx-rdy-init-'));
  let r = await cli(['init'], work);
  assert.equal(r.code, 0);
  assert.equal(await readFile(path.join(work, 'evidence', 'evidence.yaml'), 'utf8'), EVIDENCE_TEMPLATE);
  assert.ok(YAML.parse(EVIDENCE_TEMPLATE).changeRecord);
  r = await cli(['init'], work);
  assert.equal(r.code, 2);
  assert.match(r.err, /already exists/);
  assert.equal((await cli(['init', '--out', 'release/evidence.yaml'], work)).code, 0);
});
