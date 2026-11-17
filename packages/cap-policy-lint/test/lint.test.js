/**
 * What: Tests every CAP rule against the good/bad fixtures plus edge cases, symlinked paths,
 *     exemptions, baseline and CLI.
 * Why: Each rule needs proof that it fires (positive) and stays quiet on compliant code
 *     (negative).
 * If missing or unlinked: The package fails the workspace guardrail and rule regressions (false
 *     positives or misses) go unnoticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBaseline, fromSarif } from '@sapdx/findings';
import { BUNDLED_POLICY_DIR, loadPolicy } from '@sapdx/policy';
import { LintError, lintProject, runCli } from '../src/index.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const GOOD = path.join(FIXTURES, 'good');
const BAD = path.join(FIXTURES, 'bad');
const policy = await loadPolicy(BUNDLED_POLICY_DIR);
const CAP_RULES = policy.rules.filter((r) => r.tool === 'cap-policy-lint').map((r) => r.id);

const bad = await lintProject(BAD, { policy });
const good = await lintProject(GOOD, { policy });

/** Copy of the good fixture with file overrides, for targeted edge cases. */
async function variant(/** @type {Record<string, string>} */ files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cap-lint-'));
  await cp(GOOD, dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
  return dir;
}

const ids = (/** @type {{ ruleId: string }[]} */ fs) => fs.map((f) => f.ruleId);

test('compliant project has no findings and passes the gate', () => {
  assert.deepEqual(good.findings, []);
  assert.equal(good.gate.passed, true);
});

for (const ruleId of CAP_RULES) {
  test(`${ruleId} is detected in the violating fixture`, () => {
    assert.ok(ids(bad.findings).includes(ruleId), `${ruleId} not reported`);
  });
}

test('regression: project reached through a symlink is still linted', async () => {
  const link = path.join(await mkdtemp(path.join(tmpdir(), 'cap-lint-link-')), 'bad');
  await symlink(BAD, link, 'dir');
  const viaLink = await lintProject(link, { policy });
  assert.deepEqual(viaLink.findings.map((f) => f.fingerprint), bad.findings.map((f) => f.fingerprint));
});

test('violating project fails the gate with catalog severities', () => {
  assert.equal(bad.gate.passed, false);
  const sec = bad.findings.filter((f) => f.ruleId === 'CAP-SEC-001');
  assert.equal(sec.length, 3);
  assert.ok(sec.every((f) => f.severity === 'blocker' && f.baselineable === false));
  assert.ok(bad.findings.every((f) => !/\bline \d+/.test(f.message)), 'messages must not contain line numbers');
});

test('findings carry precise locations', async () => {
  // Derive the expected line from the fixture so header comments can change freely.
  const cds = (await readFile(path.join(BAD, 'srv', 'admin.cds'), 'utf8')).split('\n');
  const line = cds.findIndex((l) => l.startsWith('service AdminService')) + 1;
  const auth = bad.findings.find((f) => f.ruleId === 'CAP-AUTH-001' && f.object === 'AdminService');
  assert.deepEqual(auth?.location, { file: 'srv/admin.cds', line, column: 9 });
  const perf = bad.findings.find((f) => f.ruleId === 'CAP-PERF-001');
  assert.equal(perf?.location?.file, 'srv/admin.js');
});

test('baseline accepts legacy findings except non-baselineable secrets', async () => {
  const baseline = createBaseline(bad.findings);
  const again = await lintProject(BAD, { policy, baseline });
  assert.equal(again.gate.passed, false);
  assert.deepEqual([...new Set(ids(again.gate.blocking))], ['CAP-SEC-001']);
});

test('exemptions from the policy suppress matching findings', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cap-lint-policy-'));
  await cp(BUNDLED_POLICY_DIR, dir, { recursive: true });
  await writeFile(
    path.join(dir, 'exemptions.yaml'),
    JSON.stringify({
      version: 1,
      exemptions: [
        {
          id: 'EXM-0001',
          rule: 'CAP-AUTH-001',
          object: 'public_api',
          owner: 'jane.doe',
          approver: 'john.architect',
          justification: 'Public read-only catalogue approved by security review.',
          created: '2026-11-01',
          expires: '2027-01-31',
          backlog: 'JIRA-1',
        },
      ],
    }),
  );
  const result = await lintProject(BAD, { policyDir: dir, today: '2026-11-18' });
  const exempted = result.findings.find((f) => f.object === 'public_api' && f.ruleId === 'CAP-AUTH-001');
  assert.equal(exempted?.exemption?.id, 'EXM-0001');
  const expired = await lintProject(BAD, { policyDir: dir, today: '2027-02-01' });
  assert.ok(ids(expired.findings).includes('POL-EXEMPT-001'));
});

test('pseudo-role @requires does not protect writable entities; business role does', async () => {
  const srv = (/** @type {string} */ ann) => `using { acme.sales as sales } from '../db/schema';
${ann}
service OrderService {
  entity Orders as projection on sales.Orders actions { action cancel(); };
  function ping() returns String;
}`;
  const pseudo = await lintProject(await variant({ 'srv/order-service.cds': srv("@requires: 'authenticated-user'") }), { policy });
  assert.ok(ids(pseudo.findings).includes('CAP-AUTH-002'));
  const role = await lintProject(await variant({ 'srv/order-service.cds': srv("@requires: ['Admin']") }), { policy });
  assert.ok(!ids(role.findings).includes('CAP-AUTH-002'));
  const restricted = await lintProject(await variant({ 'srv/order-service.cds': srv("@restrict: [{ grant: '*', to: 'Admin' }]") }), { policy });
  assert.deepEqual(ids(restricted.findings), []);
});

test('remote services: .cdsrc.json is checked and destinations pass', async () => {
  const dir = await variant({
    '.cdsrc.json': JSON.stringify({
      requires: {
        ok: { kind: 'rest', credentials: { destination: 'D' } },
        inline: { kind: 'odata', '[production]': { credentials: { url: 'https://x.example.com' } } },
        db: { kind: 'sqlite' },
        broken: null,
      },
    }),
  });
  const { findings } = await lintProject(dir, { policy });
  const remote = findings.filter((f) => f.ruleId === 'CAP-REMOTE-001');
  assert.deepEqual(remote.map((f) => f.object), ['cds.requires.inline']);
  assert.equal(remote[0].location?.file, '.cdsrc.json');
});

test('secret detection: YAML, tokens, placeholders and test-folder rules', async () => {
  const jwt = `eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(12)}`;
  const dir = await variant({
    'mta.yaml': 'modules:\n  - name: srv\n    properties:\n      CLIENT_SECRET: abcd1234efgh\n      API_KEY: ${api-key}\n',
    'srv/token.js': `const accessToken = '${jwt}';\nconst S4_PASSWORD = 'changeme';\nconfig.apiKey = 'AKIAABCDEFGHIJKLMNOP';\nmodule.exports = { accessToken, S4_PASSWORD };\n`,
    'test/helper.js': "module.exports = { auth: { username: 'alice', password: 'alice-secret' } };\n",
    'srv/broken.json': '{ not json',
    'srv/broken.yaml': 'a: [',
  });
  const secrets = (await lintProject(dir, { policy })).findings.filter((f) => f.ruleId === 'CAP-SEC-001');
  const objects = secrets.map((f) => f.object).sort();
  assert.deepEqual(objects, [
    'mta.yaml#modules.0.properties.CLIENT_SECRET',
    'srv/token.js#AWS access key',
    'srv/token.js#JSON web token',
    'srv/token.js#accessToken',
    'srv/token.js#apiKey',
  ]);
});

test('unbounded SELECT detection respects keys and chained bounds', async () => {
  const dir = await variant({
    'srv/order-service.js': `const cds = require('@sap/cds');
module.exports = cds.service.impl(async function () {
  const { Orders } = this.entities;
  await SELECT.from(Orders, 1);
  await cds.ql.SELECT.from(Orders).columns('ID').where({ ID: 1 });
  await SELECT.from(Orders).orderBy('ID');
  await SELECT\`from Orders where ID = 1\`;
  if (x.Plant !== 'P1') return;
  return fetch(\`http://localhost:4004/x\`);
});
`,
  });
  const { findings } = await lintProject(dir, { policy });
  assert.deepEqual(
    findings.filter((f) => f.ruleId.startsWith('CAP-PERF') || f.ruleId.startsWith('CAP-CFG')).map((f) => `${f.ruleId}@${f.location?.line}`),
    ['CAP-PERF-001@6', 'CAP-CFG-002@8'],
  );
});

test('catalog-info.yaml: invalid YAML and missing fields', async () => {
  const invalid = await lintProject(await variant({ 'catalog-info.yaml': 'spec: [' }), { policy });
  assert.match(invalid.findings.find((f) => f.ruleId === 'CAP-API-001')?.message ?? '', /not valid YAML/);
  const partial = await lintProject(await variant({ 'catalog-info.yaml': 'spec:\n  owner: team\n' }), { policy });
  assert.match(partial.findings.find((f) => f.ruleId === 'CAP-API-001')?.message ?? '', /spec\.lifecycle.*api-version/);
});

test('project without services skips service-level rules; unparsable JS is ignored', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cap-lint-empty-'));
  await mkdir(path.join(dir, 'db'));
  await writeFile(path.join(dir, 'package.json'), '{"name":"lib"}');
  await writeFile(path.join(dir, 'db', 'schema.cds'), 'namespace acme.lib; entity Things { key ID: UUID; }');
  await mkdir(path.join(dir, 'srv'));
  await writeFile(path.join(dir, 'srv', 'x.js'), 'const = ;');
  const { findings } = await lintProject(dir, { policy });
  assert.deepEqual(findings, []);
  const noModel = await mkdtemp(path.join(tmpdir(), 'cap-lint-nomodel-'));
  assert.deepEqual((await lintProject(noModel, { policy })).findings, []);
});

test('naming checks are skipped when policy has no naming section', async () => {
  const { findings } = await lintProject(BAD, { policy: { ...policy, naming: undefined } });
  assert.ok(!ids(findings).includes('CAP-NAME-001'));
});

test('invalid projects raise LintError', async () => {
  await assert.rejects(lintProject(await variant({ 'db/schema.cds': 'entity {' }), { policy }), LintError);
  await assert.rejects(lintProject(await variant({ 'package.json': '{' }), { policy }), /Invalid JSON in package.json/);
  await assert.rejects(lintProject(await variant({ '.cdsrc.json': '{' }), { policy }), /Invalid JSON in .cdsrc.json/);
});

test('CLI: text, sarif, baseline, help and usage errors', async () => {
  /** @type {string[]} */
  let out = [];
  /** @type {string[]} */
  let err = [];
  const io = { stdout: (/** @type {string} */ s) => out.push(s), stderr: (/** @type {string} */ s) => err.push(s) };

  assert.equal(await runCli([GOOD, '--policy', BUNDLED_POLICY_DIR], io), 0);
  assert.match(out.join('\n'), /GATE PASSED/);

  const dir = await mkdtemp(path.join(tmpdir(), 'cap-lint-cli-'));
  const sarifFile = path.join(dir, 'reports', 'cap.sarif');
  out = [];
  assert.equal(await runCli([BAD, '--format', 'sarif', '--out', sarifFile, '--policy', BUNDLED_POLICY_DIR], io), 1);
  assert.match(out.join('\n'), /written to .*gate failed/);
  const sarif = JSON.parse(await readFile(sarifFile, 'utf8'));
  assert.deepEqual(fromSarif(sarif).map((f) => f.fingerprint), bad.findings.map((f) => f.fingerprint));
  assert.ok(sarif.runs[0].tool.driver.rules.every((/** @type {any} */ r) => r.id.startsWith('CAP-')));

  const baselineFile = path.join(dir, 'baseline.json');
  await writeFile(baselineFile, JSON.stringify(createBaseline(bad.findings)));
  out = [];
  assert.equal(await runCli([BAD, '--baseline', baselineFile, '--policy', BUNDLED_POLICY_DIR, '--today', '2026-11-18'], io), 1);
  assert.match(out.join('\n'), /GATE FAILED: 3 new/);

  out = [];
  assert.equal(await runCli(['--help'], io), 0);
  assert.match(out[0], /^Usage: cap-policy-lint/);

  for (const args of [['a', 'b'], ['--format', 'xml'], ['--today', '18.11.2026'], ['--nope']]) {
    err = [];
    assert.equal(await runCli(args, io), 2, args.join(' '));
    assert.match(err.join('\n'), /cap-policy-lint: /);
  }
});
