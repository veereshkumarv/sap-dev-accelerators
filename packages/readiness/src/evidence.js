/**
 * What: Collects and parses release evidence from a folder: SARIF findings, JUnit XML test results
 *     (split into regular and contract tests), lcov / coverage-summary.json, npm audit JSON,
 *     gitleaks reports, odata-diff JSON and the evidence.yaml manifest.
 * Why: The readiness decision must be based on the artefacts pipelines already produce, discovered
 *     by convention, so teams add evidence by dropping files rather than writing glue code.
 * If missing or unlinked: The readiness checker sees no evidence and every mandatory check reports
 *     "missing" (Red).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import YAML from 'yaml';

/**
 * @typedef {{ file: string, tests: number, failures: number, errors: number, skipped: number }} JUnitResult
 *
 * @typedef {object} Evidence
 * @property {string} dir
 * @property {string[]} files                         relative paths found
 * @property {Array<{ file: string, json: any }>} sarif  quality findings (secret-scan SARIF excluded)
 * @property {JUnitResult[]} tests
 * @property {JUnitResult[]} contractTests
 * @property {{ file: string, linesPct: number } | undefined} coverage
 * @property {{ file: string, counts: Record<string, number> } | undefined} audit
 * @property {{ file: string, leaks: number } | undefined} secrets
 * @property {{ file: string, report: any } | undefined} apiDiff
 * @property {any} manifest                            evidence.yaml (or {})
 * @property {string[]} problems                       unreadable files
 */

const CONTRACT = /contract|api-tests|newman/i;
const SECRETS = /gitleaks|secret/i;

/**
 * @param {string} dir
 * @returns {Promise<Evidence>}
 */
export async function collectEvidence(dir) {
  const root = path.resolve(dir);
  /** @type {string[]} */
  let files;
  try {
    files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => path.relative(root, path.join(e.parentPath, e.name)).replaceAll('\\', '/'))
      .filter((f) => !f.split('/').includes('node_modules'))
      .sort();
  } catch {
    throw new Error(`Evidence folder not found: ${dir}`);
  }
  /** @type {Evidence} */
  const ev = { dir: root, files, sarif: [], tests: [], contractTests: [], coverage: undefined, audit: undefined, secrets: undefined, apiDiff: undefined, manifest: {}, problems: [] };
  const read = (/** @type {string} */ f) => readFile(path.join(root, f), 'utf8');
  const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

  for (const f of files) {
    const base = path.basename(f);
    try {
      if (base === 'evidence.yaml' || base === 'evidence.yml') {
        ev.manifest = YAML.parse(await read(f)) ?? {};
      } else if (f.endsWith('.sarif') || f.endsWith('.sarif.json')) {
        const json = JSON.parse(await read(f));
        if (SECRETS.test(base)) ev.secrets = { file: f, leaks: (json.runs ?? []).reduce((/** @type {number} */ n, /** @type {any} */ r) => n + (r.results?.length ?? 0), 0) };
        else ev.sarif.push({ file: f, json });
      } else if (SECRETS.test(base) && base.endsWith('.json')) {
        const json = JSON.parse(await read(f));
        ev.secrets = { file: f, leaks: Array.isArray(json) ? json.length : 0 };
      } else if (base === 'lcov.info') {
        ev.coverage = { file: f, linesPct: lcovPercent(await read(f)) };
      } else if (base === 'coverage-summary.json') {
        const pct = JSON.parse(await read(f))?.total?.lines?.pct;
        if (typeof pct === 'number') ev.coverage = { file: f, linesPct: pct };
      } else if (/audit/i.test(base) && base.endsWith('.json')) {
        const json = JSON.parse(await read(f));
        ev.audit = { file: f, counts: json?.metadata?.vulnerabilities ?? {} };
      } else if (/api-diff/i.test(base) && base.endsWith('.json')) {
        ev.apiDiff = { file: f, report: JSON.parse(await read(f)) };
      } else if (f.endsWith('.xml')) {
        const result = junit(f, xml.parse(await read(f)));
        if (result) (CONTRACT.test(f) ? ev.contractTests : ev.tests).push(result);
      }
    } catch (err) {
      ev.problems.push(`${f}: ${/** @type {Error} */ (err).message}`);
    }
  }
  return ev;
}

/**
 * Line coverage from lcov (LF = lines found, LH = lines hit, summed over all files).
 * @param {string} text
 */
export function lcovPercent(text) {
  let found = 0;
  let hit = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('LF:')) found += Number(line.slice(3));
    if (line.startsWith('LH:')) hit += Number(line.slice(3));
  }
  return found === 0 ? 0 : Math.round((hit / found) * 10000) / 100;
}

/**
 * Totals of a JUnit document (testsuites > testsuite > testcase, any nesting); undefined when
 * the XML is not a JUnit report.
 * @param {string} file
 * @param {any} doc
 * @returns {JUnitResult | undefined}
 */
export function junit(file, doc) {
  const roots = doc?.testsuites ?? (doc?.testsuite ? { testsuite: doc.testsuite } : undefined);
  // An empty <testsuites/> parses to '' and is a valid report with zero tests.
  if (roots === undefined) return undefined;
  const result = { file, tests: 0, failures: 0, errors: 0, skipped: 0 };
  /** @param {any} suite */
  const visit = (suite) => {
    for (const s of [suite].flat()) {
      if (!s || typeof s !== 'object') continue;
      for (const c of [s.testcase ?? []].flat()) {
        result.tests += 1;
        if (c?.failure !== undefined) result.failures += 1;
        else if (c?.error !== undefined) result.errors += 1;
        else if (c?.skipped !== undefined) result.skipped += 1;
      }
      if (s.testsuite) visit(s.testsuite);
    }
  };
  visit(roots.testsuite ?? []);
  return result;
}
