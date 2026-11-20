/**
 * What: The readiness checks (RDY-*): each turns one kind of evidence into pass / warn / fail /
 *     missing / skipped / n/a with a human-readable detail and the evidence files it used.
 * Why: Every release criterion is a small, separately tested function, so a reviewer can see exactly
 *     why a release is Red or Amber and which artefact to fix.
 * If missing or unlinked: readiness.js has no checks to run; every release would be undecidable.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { XMLParser } from 'fast-xml-parser';
import { evaluateGate, fromSarif } from '@sapdx/findings';
import { applyPolicy } from '@sapdx/policy';

/**
 * @typedef {import('./evidence.js').Evidence} Evidence
 * @typedef {'pass' | 'warn' | 'fail' | 'missing' | 'skipped' | 'n/a'} Status
 *
 * @typedef {object} CheckResult
 * @property {string} id
 * @property {Status} status
 * @property {string} detail
 * @property {string[]} evidence   files the result is based on
 *
 * @typedef {object} CheckContext
 * @property {Evidence} ev
 * @property {import('@sapdx/policy').Policy} policy
 * @property {string} target                     DEV / QA / PROD ...
 * @property {{ min: number, warn?: number } | undefined} coverage
 * @property {any} thresholds                    readiness.yaml thresholds
 * @property {import('@sapdx/findings').Baseline} [baseline]
 * @property {string} today
 */

/** @type {Record<string, (ctx: CheckContext) => Promise<Omit<CheckResult, 'id'>> | Omit<CheckResult, 'id'>>} */
export const CHECKS = {
  'RDY-FINDINGS': checkFindings,
  'RDY-TESTS': (ctx) => checkTests(ctx.ev.tests, ctx.thresholds?.minTests ?? 1, 'test'),
  'RDY-CONTRACT': (ctx) => checkTests(ctx.ev.contractTests, 1, 'contract test'),
  'RDY-COVERAGE': checkCoverage,
  'RDY-DEPS': checkDependencies,
  'RDY-SECRETS': checkSecrets,
  'RDY-DESCRIPTOR': checkDescriptor,
  'RDY-API-COMPAT': checkApiCompat,
  'RDY-DB-MIGRATION': checkDbMigration,
  'RDY-ROLLBACK': checkRollback,
  'RDY-CHANGE-RECORD': checkChangeRecord,
  'RDY-PROD-CONFIG': checkProdConfig,
  'RDY-TRANSPORT': checkTransports,
};

/** @param {string} detail */
const missing = (detail) => ({ status: /** @type {Status} */ ('missing'), detail, evidence: [] });

/** @param {CheckContext} ctx */
function checkFindings({ ev, policy, baseline, today }) {
  if (!ev.sarif.length) return missing('No SARIF findings (e.g. cap-policy-lint, abap-policy-lint, sapdx-gate output).');
  const raw = ev.sarif.flatMap((s) => fromSarif(s.json));
  const { findings } = applyPolicy(raw, policy, { today });
  const gate = evaluateGate(findings, { baseline });
  const newMajor = gate.introduced.filter((f) => !f.exemption && f.severity === 'major');
  const files = ev.sarif.map((s) => s.file);
  const summary = `${findings.length} finding(s), ${gate.introduced.length} new, ${gate.existing.length} accepted by baseline`;
  if (!gate.passed) {
    const first = gate.blocking.slice(0, 3).map((f) => `${f.ruleId}${f.location ? ` (${f.location.file}${f.location.line ? `:${f.location.line}` : ''})` : f.object ? ` (${f.object})` : ''}`);
    return { status: /** @type {Status} */ ('fail'), detail: `${gate.blocking.length} new Blocker/Critical finding(s): ${first.join(', ')}${gate.blocking.length > 3 ? ', ...' : ''}; ${summary}.`, evidence: files };
  }
  if (newMajor.length) return { status: /** @type {Status} */ ('warn'), detail: `${newMajor.length} new Major finding(s); ${summary}.`, evidence: files };
  return { status: /** @type {Status} */ ('pass'), detail: `No new Blocker/Critical findings; ${summary}.`, evidence: files };
}

/**
 * @param {import('./evidence.js').JUnitResult[]} reports
 * @param {number} minTests
 * @param {string} label
 */
export function checkTests(reports, minTests, label) {
  if (!reports.length) return missing(`No ${label} results (JUnit XML).`);
  const t = reports.reduce((a, r) => ({ tests: a.tests + r.tests, failures: a.failures + r.failures, errors: a.errors + r.errors, skipped: a.skipped + r.skipped }), { tests: 0, failures: 0, errors: 0, skipped: 0 });
  const files = reports.map((r) => r.file);
  const counts = `${t.tests} ${label}(s), ${t.failures} failed, ${t.errors} error(s), ${t.skipped} skipped`;
  if (t.failures + t.errors > 0) return { status: /** @type {Status} */ ('fail'), detail: `${counts}.`, evidence: files };
  if (t.tests - t.skipped < minTests) return { status: /** @type {Status} */ ('fail'), detail: `${counts}; at least ${minTests} executed ${label}(s) required.`, evidence: files };
  if (t.skipped > 0) return { status: /** @type {Status} */ ('warn'), detail: `${counts}; skipped ${label}s hide untested behaviour.`, evidence: files };
  return { status: /** @type {Status} */ ('pass'), detail: `${counts}.`, evidence: files };
}

/** @param {CheckContext} ctx */
function checkCoverage({ ev, coverage }) {
  if (!ev.coverage) return missing('No coverage report (lcov.info or coverage-summary.json).');
  const min = coverage?.min ?? 0;
  const warn = coverage?.warn ?? min;
  const pct = ev.coverage.linesPct;
  const evidence = [ev.coverage.file];
  if (pct < min) return { status: /** @type {Status} */ ('fail'), detail: `Line coverage ${pct} % is below the minimum of ${min} %.`, evidence };
  if (pct < warn) return { status: /** @type {Status} */ ('warn'), detail: `Line coverage ${pct} % meets the minimum (${min} %) but is below the target of ${warn} %.`, evidence };
  return { status: /** @type {Status} */ ('pass'), detail: `Line coverage ${pct} % (minimum ${min} %).`, evidence };
}

/** @param {CheckContext} ctx */
function checkDependencies({ ev, thresholds }) {
  if (!ev.audit) return missing('No dependency audit (npm audit --json > npm-audit.json).');
  /** @type {string[]} */
  const fail = thresholds?.vulnerabilities?.fail ?? ['critical', 'high'];
  /** @type {string[]} */
  const warn = thresholds?.vulnerabilities?.warn ?? ['moderate'];
  const c = ev.audit.counts;
  const list = (/** @type {string[]} */ levels) => levels.filter((l) => (c[l] ?? 0) > 0).map((l) => `${c[l]} ${l}`);
  const evidence = [ev.audit.file];
  if (list(fail).length) return { status: /** @type {Status} */ ('fail'), detail: `Vulnerable dependencies: ${list(fail).join(', ')}. Update or replace them (npm audit fix).`, evidence };
  if (list(warn).length) return { status: /** @type {Status} */ ('warn'), detail: `Vulnerable dependencies: ${list(warn).join(', ')}.`, evidence };
  return { status: /** @type {Status} */ ('pass'), detail: `No ${[...fail, ...warn].join('/')} vulnerabilities.`, evidence };
}

/** @param {CheckContext} ctx */
function checkSecrets({ ev }) {
  if (!ev.secrets) return missing('No secret-scan report (gitleaks SARIF or JSON).');
  const evidence = [ev.secrets.file];
  if (ev.secrets.leaks > 0) return { status: /** @type {Status} */ ('fail'), detail: `${ev.secrets.leaks} secret(s) detected. Revoke and rotate them, then remove them from the history.`, evidence };
  return { status: /** @type {Status} */ ('pass'), detail: 'No secrets detected.', evidence };
}

const CREDENTIAL_KEY = /^(password|passwd|pwd|secret|clientsecret|client_secret|token|apikey|api_key|private_?key)$/i;

/** @param {CheckContext} ctx */
async function checkDescriptor({ ev }) {
  const project = projectDir(ev);
  if (!project) return missing('No project path in evidence.yaml (project: <path>), so the deployment descriptor cannot be checked.');
  const mta = await readText(path.join(project, 'mta.yaml'));
  if (mta !== undefined) {
    const evidence = [rel(ev, path.join(project, 'mta.yaml'))];
    let doc;
    try {
      doc = YAML.parse(mta);
    } catch (err) {
      return { status: /** @type {Status} */ ('fail'), detail: `mta.yaml is not valid YAML: ${/** @type {Error} */ (err).message.split('\n')[0]}`, evidence };
    }
    /** @type {string[]} */
    const problems = [];
    for (const key of ['_schema-version', 'ID', 'version']) if (!doc?.[key]) problems.push(`${key} missing`);
    if (!Array.isArray(doc?.modules) || !doc.modules.length) problems.push('no modules');
    for (const m of doc?.modules ?? []) if (!m?.name || !m?.type) problems.push(`module ${m?.name ?? '?'} without name or type`);
    for (const p of credentialPaths(doc)) problems.push(`literal credential at ${p}`);
    const manifestVersion = ev.manifest?.version;
    if (manifestVersion && doc?.version && String(doc.version) !== String(manifestVersion)) problems.push(`version ${doc.version} differs from release version ${manifestVersion}`);
    if (problems.length) return { status: /** @type {Status} */ ('fail'), detail: `mta.yaml: ${problems.join('; ')}.`, evidence };
    return { status: /** @type {Status} */ ('pass'), detail: `mta.yaml ${doc.ID} ${doc.version}: ${doc.modules.length} module(s), no literal credentials.`, evidence };
  }
  const abapgit = await readText(path.join(project, '.abapgit.xml'));
  if (abapgit !== undefined) {
    const evidence = [rel(ev, path.join(project, '.abapgit.xml'))];
    // abapGit writes a UTF-8 byte order mark.
    const data = new XMLParser().parse(abapgit.replace(/^\uFEFF/, ''))?.['asx:abap']?.['asx:values']?.DATA;
    if (!data?.MASTER_LANGUAGE || !data?.STARTING_FOLDER) return { status: /** @type {Status} */ ('fail'), detail: '.abapgit.xml lacks MASTER_LANGUAGE or STARTING_FOLDER.', evidence };
    return { status: /** @type {Status} */ ('pass'), detail: `abapGit repository (language ${data.MASTER_LANGUAGE}, folder ${data.STARTING_FOLDER}).`, evidence };
  }
  return { status: /** @type {Status} */ ('fail'), detail: `No deployment descriptor (mta.yaml or .abapgit.xml) in ${rel(ev, project)}.`, evidence: [] };
}

/**
 * Paths of keys that look like credentials and hold a literal value (not an MTA ${placeholder}).
 * @param {any} node
 * @param {string} [at]
 * @returns {string[]}
 */
export function credentialPaths(node, at = '') {
  if (Array.isArray(node)) return node.flatMap((v, i) => credentialPaths(v, `${at}[${i}]`));
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([k, v]) => {
    const p = at ? `${at}.${k}` : k;
    if (CREDENTIAL_KEY.test(k) && (typeof v === 'string' || typeof v === 'number') && !/^\$\{.+\}$/.test(String(v))) return [p];
    return credentialPaths(v, p);
  });
}

/** @param {CheckContext} ctx */
function checkApiCompat({ ev }) {
  if (!ev.apiDiff) return missing('No API compatibility report (odata-diff <snapshot> <project> --format json --out api-diff.json).');
  const r = ev.apiDiff.report;
  const evidence = [ev.apiDiff.file];
  const breaking = Number(r?.breaking ?? 0);
  if (breaking === 0) {
    const additive = Number(r?.additive ?? 0);
    return { status: /** @type {Status} */ ('pass'), detail: additive ? `${additive} additive change(s), no breaking changes.` : 'No API changes.', evidence };
  }
  const now = semver(ev.manifest?.version);
  const before = semver(ev.manifest?.previousVersion);
  if (!now || !before) return { status: /** @type {Status} */ ('fail'), detail: `${breaking} breaking API change(s); evidence.yaml must state version and previousVersion to prove a major version bump.`, evidence };
  if (now[0] > before[0]) return { status: /** @type {Status} */ ('pass'), detail: `${breaking} breaking API change(s) released as new major version ${ev.manifest.version} (was ${ev.manifest.previousVersion}).`, evidence };
  return { status: /** @type {Status} */ ('fail'), detail: `${breaking} breaking API change(s) but version ${ev.manifest.version} is not a major bump over ${ev.manifest.previousVersion}.`, evidence };
}

/** @param {unknown} v */
function semver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''));
  return m ? m.slice(1).map(Number) : undefined;
}

/** @param {CheckContext} ctx */
async function checkDbMigration({ ev }) {
  const db = ev.manifest?.dbMigration;
  if (!db) return missing('evidence.yaml has no dbMigration section (destructive: true|false, plan: <file>).');
  if (!db.destructive) return { status: /** @type {Status} */ ('pass'), detail: 'No destructive database changes declared.', evidence: ['evidence.yaml'] };
  if (!db.plan) return { status: /** @type {Status} */ ('fail'), detail: 'Destructive database change declared without a migration plan.', evidence: ['evidence.yaml'] };
  return evidenceFile(ev, db.plan, 'Migration plan');
}

/** @param {CheckContext} ctx */
function checkRollback({ ev }) {
  const file = ev.manifest?.rollback;
  if (!file) return missing('evidence.yaml has no rollback entry (path to the rollback / roll-forward procedure).');
  return evidenceFile(ev, file, 'Rollback procedure');
}

/**
 * @param {Evidence} ev
 * @param {string} file
 * @param {string} label
 */
async function evidenceFile(ev, file, label) {
  const text = await readText(path.resolve(ev.dir, file));
  if (text === undefined) return { status: /** @type {Status} */ ('fail'), detail: `${label} ${file} not found.`, evidence: ['evidence.yaml'] };
  if (!text.trim()) return { status: /** @type {Status} */ ('fail'), detail: `${label} ${file} is empty.`, evidence: [file] };
  return { status: /** @type {Status} */ ('pass'), detail: `${label} documented in ${file}.`, evidence: [file] };
}

/** @param {CheckContext} ctx */
function checkChangeRecord({ ev, thresholds }) {
  const record = ev.manifest?.changeRecord;
  if (!record) return missing('evidence.yaml has no changeRecord.');
  const pattern = new RegExp(thresholds?.changeRecordPattern ?? '.+');
  if (!pattern.test(String(record))) return { status: /** @type {Status} */ ('fail'), detail: `Change record "${record}" does not match ${pattern.source}.`, evidence: ['evidence.yaml'] };
  return { status: /** @type {Status} */ ('pass'), detail: `Change record ${record}.`, evidence: ['evidence.yaml'] };
}

const DEV_AUTH = new Set(['mocked', 'dummy', 'basic']);

/** @param {CheckContext} ctx */
async function checkProdConfig({ ev }) {
  const project = projectDir(ev);
  if (!project) return missing('No project path in evidence.yaml, so the production profile cannot be checked.');
  const pkgText = await readText(path.join(project, 'package.json'));
  const pkg = pkgText === undefined ? undefined : JSON.parse(pkgText);
  // A project without package.json (abapGit / RAP) has its production settings in the ABAP system.
  const isCap = Boolean(pkg?.cds || pkg?.dependencies?.['@sap/cds']);
  if (!isCap) return { status: /** @type {Status} */ ('n/a'), detail: 'Not a CAP project; production configuration lives in the ABAP system.', evidence: [] };
  const rcText = await readText(path.join(project, '.cdsrc.json'));
  const cds = { ...pkg.cds, ...(rcText ? JSON.parse(rcText) : {}) };
  const evidence = [rel(ev, path.join(project, 'package.json')), ...(rcText ? [rel(ev, path.join(project, '.cdsrc.json'))] : [])];
  const requires = cds.requires ?? {};
  const prod = requires['[production]'] ?? {};
  /** @type {string[]} */
  const problems = [];
  const auth = kind(prod.auth ?? requires.auth);
  if (!auth || DEV_AUTH.has(auth)) problems.push(`authentication in production is "${auth ?? 'not configured'}" (use xsuaa or ias)`);
  const db = kind(prod.db ?? requires.db);
  if (db && /sqlite/.test(db)) problems.push(`database in production is "${db}"`);
  for (const [name, svc] of Object.entries(prod)) {
    if (svc && typeof svc === 'object' && /** @type {any} */ (svc).credentials?.url) problems.push(`remote service ${name} uses an inline URL instead of a destination`);
  }
  if (problems.length) return { status: /** @type {Status} */ ('fail'), detail: `Production profile: ${problems.join('; ')}.`, evidence };
  return { status: /** @type {Status} */ ('pass'), detail: `Production profile uses ${auth} authentication${db ? ` and ${db}` : ''}.`, evidence };
}

/** @param {unknown} value  cds.requires entry: "kind" string or { kind } */
function kind(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (/** @type {any} */ (value).kind) === 'string') return /** @type {any} */ (value).kind;
  return undefined;
}

/** @param {CheckContext} ctx */
function checkTransports({ ev, target }) {
  const t = ev.manifest?.transports;
  if (!t || !Array.isArray(t.requests)) return missing('evidence.yaml has no transports section (targetSystem, requests with predecessors).');
  const system = t.targetSystem ?? target;
  /** @type {string[]} */
  const open = [];
  for (const r of t.requests) {
    for (const p of r?.predecessors ?? []) {
      if (!(p?.importedIn ?? []).includes(system)) open.push(`${r.id} needs ${p.id}`);
    }
  }
  if (open.length) return { status: /** @type {Status} */ ('fail'), detail: `Predecessors not imported in ${system}: ${open.join(', ')}.`, evidence: ['evidence.yaml'] };
  return { status: /** @type {Status} */ ('pass'), detail: `${t.requests.length} transport request(s); all predecessors imported in ${system}.`, evidence: ['evidence.yaml'] };
}

/** @param {Evidence} ev */
function projectDir(ev) {
  return ev.manifest?.project ? path.resolve(ev.dir, ev.manifest.project) : undefined;
}

/**
 * @param {Evidence} ev
 * @param {string} file
 */
function rel(ev, file) {
  return path.relative(ev.dir, file).replaceAll('\\', '/') || '.';
}

/** @param {string} file */
async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}
