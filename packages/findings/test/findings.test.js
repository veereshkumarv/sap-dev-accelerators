/**
 * What: Unit tests for severity, finding validation, fingerprints, SARIF round trip, baseline
 *     diff and gate logic.
 * Why: This library decides what blocks a release; regressions here would silently change every
 *     gate.
 * If missing or unlinked: The package fails the workspace guardrail and behaviour changes in the
 *     shared contract go untested.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEVERITIES,
  compareSeverity,
  createBaseline,
  createFinding,
  diffBaseline,
  evaluateGate,
  formatText,
  fromSarif,
  fromSarifLevel,
  isBlocking,
  isSeverity,
  normaliseRuleId,
  parseBaseline,
  severityRank,
  toSarif,
  toSarifLevel,
} from '../src/index.js';

const base = { ruleId: 'CAP-AUTH-001', severity: /** @type {const} */ ('critical'), message: 'Service has no @requires', tool: 't' };

test('severity scale is ordered and blocking is blocker+critical only', () => {
  assert.deepEqual(SEVERITIES, ['blocker', 'critical', 'major', 'minor']);
  assert.equal(severityRank('blocker'), 0);
  assert.ok(compareSeverity('blocker', 'minor') < 0);
  assert.deepEqual(SEVERITIES.map(isBlocking), [true, true, false, false]);
  assert.equal(isSeverity('major'), true);
  assert.equal(isSeverity('high'), false);
  assert.throws(() => severityRank(/** @type {any} */ ('high')), /Unknown severity/);
});

test('SARIF level mapping both directions', () => {
  assert.deepEqual(SEVERITIES.map(toSarifLevel), ['error', 'error', 'warning', 'note']);
  assert.throws(() => toSarifLevel(/** @type {any} */ ('x')));
  assert.equal(fromSarifLevel('error'), 'critical');
  assert.equal(fromSarifLevel('warning'), 'major');
  assert.equal(fromSarifLevel(undefined), 'major');
  assert.equal(fromSarifLevel('note'), 'minor');
});

test('createFinding validates input', () => {
  assert.throws(() => createFinding(/** @type {any} */ (null)), /must be an object/);
  assert.throws(() => createFinding({ ...base, ruleId: 'bad id' }), /Invalid ruleId/);
  assert.throws(() => createFinding({ ...base, severity: /** @type {any} */ ('high') }), /Invalid severity/);
  assert.throws(() => createFinding({ ...base, message: ' ' }), /Missing message/);
  assert.throws(() => createFinding({ ...base, tool: '' }), /Missing tool/);
  assert.throws(() => createFinding({ ...base, location: { file: '' } }), /location.file/);
  assert.throws(() => createFinding({ ...base, location: { file: 'a', line: 0 } }), /location.line/);
  assert.throws(() => createFinding({ ...base, location: { file: 'a', column: 1.5 } }), /location.column/);
});

test('fingerprint is stable across line moves and path styles', () => {
  const a = createFinding({ ...base, location: { file: './srv\\cat.cds', line: 3, column: 2 }, object: 'CatalogService' });
  const b = createFinding({ ...base, location: { file: 'srv/cat.cds', line: 40 }, object: 'CatalogService' });
  assert.equal(a.location?.file, 'srv/cat.cds');
  assert.equal(a.fingerprint, b.fingerprint);
  const c = createFinding({ ...base, object: 'OtherService' });
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.equal(createFinding({ ...base, fingerprint: 'fixed' }).fingerprint, 'fixed');
});

test('SARIF round trip keeps severity, location, fingerprint and exemption', () => {
  const findings = [
    createFinding({ ...base, location: { file: 'srv/cat.cds', line: 3, column: 5 }, object: 'CatalogService' }),
    createFinding({
      ruleId: 'ABAP-CC-001',
      severity: 'blocker',
      message: 'Unreleased API',
      tool: 'abap-policy-lint',
      baselineable: false,
      exemption: { id: 'EXM-0001', owner: 'a', expires: '2027-01-01', justification: 'no successor yet' },
    }),
    createFinding({ ruleId: 'CAP-LOG-001', severity: 'minor', message: 'console.log', tool: 't', location: { file: 'x.js' } }),
  ];
  const sarif = toSarif(findings, {
    tool: { name: 'demo', version: '1.0.0', informationUri: 'https://example.invalid' },
    rules: [{ id: 'CAP-AUTH-001', title: 'Auth', description: 'Long', helpUri: 'https://h', severity: 'critical' }],
  });
  assert.equal(sarif.version, '2.1.0');
  const driver = sarif.runs[0].tool.driver;
  assert.deepEqual(driver.rules.map((r) => r.id), ['ABAP-CC-001', 'CAP-AUTH-001', 'CAP-LOG-001']);
  const back = fromSarif(JSON.parse(JSON.stringify(sarif)));
  assert.deepEqual(back, findings);
});

test('fromSarif handles third-party SARIF without severity properties', () => {
  const sarif = {
    runs: [
      {
        tool: { driver: { name: 'gitleaks', rules: [{ id: 'generic-api-key', shortDescription: { text: 'Generic API key' } }] } },
        results: [
          { ruleId: 'generic-api-key', message: { text: '' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 2 } } }] },
          { ruleId: 'other', level: 'note', message: { text: 'n' }, suppressions: [{ kind: 'inSource' }] },
        ],
      },
      { tool: { driver: {} }, results: [{ ruleId: 'X-1', level: 'error', message: { text: 'boom' }, properties: { severity: 'blocker' } }] },
    ],
  };
  const [leak, note, ext] = fromSarif(sarif, { defaultTool: 'fallback' });
  assert.equal(leak.ruleId, 'EXT-GITLEAKS-GENERIC_API_KEY');
  assert.equal(leak.severity, 'major');
  assert.equal(leak.message, 'Generic API key');
  assert.equal(leak.location?.line, 2);
  assert.equal(note.severity, 'minor');
  assert.equal(note.exemption?.id, 'EXTERNAL');
  assert.equal(ext.tool, 'fallback');
  assert.equal(ext.severity, 'blocker');
  assert.throws(() => fromSarif({}), /Not a SARIF log/);
  assert.equal(normaliseRuleId('--', 'x'), 'EXT-X-X');
});

test('fromSarif uses rule default severity when result has none', () => {
  const sarif = {
    runs: [{ tool: { driver: { name: 'x', rules: [{ id: 'R-1', properties: { severity: 'blocker' } }] } }, results: [{ ruleId: 'R-1', message: { text: 'm' } }] }],
  };
  assert.equal(fromSarif(sarif)[0].severity, 'blocker');
});

test('baseline diff counts occurrences and respects baselineable=false', () => {
  const a = createFinding(base);
  const dup = createFinding(base);
  const pinned = createFinding({ ...base, ruleId: 'POL-EXEMPT-001', severity: 'blocker', baselineable: false });
  const exempt = createFinding({ ...base, ruleId: 'CAP-X-1', exemption: { id: 'E', owner: 'o', expires: '2030-01-01', justification: 'j' } });
  const baseline = createBaseline([a, pinned, exempt], { createdAt: '2026-11-17' });
  assert.equal(baseline.fingerprints[exempt.fingerprint], undefined);
  assert.equal(parseBaseline(baseline), baseline);

  const diff = diffBaseline([a, dup, pinned], baseline);
  assert.deepEqual(diff.existing, [a]);
  assert.deepEqual(diff.introduced, [dup, pinned]);
  assert.equal(diff.resolvedCount, 1);

  assert.throws(() => parseBaseline({ version: 2 }), /Invalid baseline/);
  assert.throws(() => parseBaseline({ version: 1, fingerprints: { x: 0 } }), /Invalid baseline count/);
});

test('gate blocks only new, non-exempted blocker/critical findings', () => {
  const legacy = createFinding(base);
  const minor = createFinding({ ...base, ruleId: 'CAP-LOG-001', severity: 'minor' });
  const exempted = createFinding({ ...base, ruleId: 'CAP-X-2', exemption: { id: 'E', owner: 'o', expires: '2030-01-01', justification: 'j' } });
  const baseline = createBaseline([legacy]);
  assert.equal(evaluateGate([legacy, minor, exempted], { baseline }).passed, true);
  const fresh = createFinding({ ...base, object: 'New' });
  const result = evaluateGate([legacy, fresh]);
  assert.equal(result.passed, false);
  assert.equal(result.blocking.length, 2);
});

test('formatText prints sorted report with summary', () => {
  assert.equal(formatText([]), 'No findings.');
  const text = formatText([
    createFinding({ ...base, severity: 'minor', location: { file: 'b.js', line: 2 } }),
    createFinding({ ...base, severity: 'blocker', object: 'Obj', exemption: { id: 'E1', owner: 'o', expires: '2030-01-01', justification: 'j' } }),
    createFinding({ ...base, severity: 'minor', location: { file: 'a.js' } }),
  ]);
  const lines = text.split('\n');
  assert.match(lines[0], /^BLOCKER .*Obj.*\[exempted E1 until 2030-01-01\]/);
  assert.match(lines[1], /a\.js/);
  assert.match(lines[2], /b\.js:2/);
  assert.match(text, /3 finding\(s\): 1 blocker, 2 minor$/);
});
