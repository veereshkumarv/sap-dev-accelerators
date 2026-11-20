/**
 * What: Runs the readiness checks for one deployment target and derives the Red / Amber / Green
 *     release decision with the reasons behind it.
 * Why: The decision rule must be explicit and identical everywhere: one failed Blocker/Critical
 *     check or one missing mandatory piece of evidence is Red - results are never averaged.
 * If missing or unlinked: The CLI and programmatic callers cannot produce a decision; releases go
 *     out without a readiness verdict.
 */
import { readFile } from 'node:fs/promises';
import { parseBaseline } from '@sapdx/findings';
import { isoToday, loadPolicy, resolvePolicyDir } from '@sapdx/policy';
import { CHECKS } from './checks.js';
import { collectEvidence } from './evidence.js';

/**
 * @typedef {'GREEN' | 'AMBER' | 'RED'} Decision
 *
 * @typedef {import('./checks.js').CheckResult & {
 *   title: string, severity: import('@sapdx/findings').Severity, mandatory: boolean
 * }} ReportedCheck
 *
 * @typedef {object} Assessment
 * @property {string} target
 * @property {Decision} decision
 * @property {string[]} reasons        why the decision is not Green (empty when Green)
 * @property {ReportedCheck[]} checks
 * @property {string[]} problems       evidence files that could not be read
 * @property {{ version?: string, changeRecord?: string, project?: string }} release
 * @property {string} evidenceDir
 * @property {string} today
 *
 * @typedef {object} AssessOptions
 * @property {string} evidenceDir
 * @property {string} target
 * @property {string} [policyDir]
 * @property {string} [baselineFile]
 * @property {string} [today]
 * @property {string} [cwd]
 */

/**
 * @param {AssessOptions} options
 * @returns {Promise<Assessment>}
 */
export async function assess(options) {
  const { evidenceDir, baselineFile, today = isoToday(), cwd = process.cwd() } = options;
  const target = options.target.toUpperCase();
  const policy = await loadPolicy(await resolvePolicyDir(options.policyDir, cwd));
  const readiness = policy.readiness;
  if (!readiness) throw new Error(`No readiness.yaml in policy directory ${policy.dir}`);
  const targetPolicy = readiness.targets[target];
  if (!targetPolicy) throw new Error(`Unknown target ${target}; readiness.yaml defines ${Object.keys(readiness.targets).join(', ')}`);

  const ev = await collectEvidence(evidenceDir);
  const baseline = baselineFile ? parseBaseline(JSON.parse(await readFile(baselineFile, 'utf8'))) : undefined;
  /** @type {Set<string>} */
  const mandatory = new Set(targetPolicy.mandatory);
  /** @type {import('./checks.js').CheckContext} */
  const ctx = { ev, policy, target, coverage: targetPolicy.coverage, thresholds: readiness.thresholds ?? {}, baseline, today };

  /** @type {ReportedCheck[]} */
  const checks = [];
  for (const [id, run] of Object.entries(CHECKS)) {
    const rule = policy.ruleFor(id);
    if (rule?.enabled === false) continue;
    const result = await run(ctx);
    const isMandatory = mandatory.has(id);
    const status = result.status === 'missing' && !isMandatory ? 'skipped' : result.status;
    checks.push({ id, title: rule?.title ?? id, severity: rule?.severity ?? 'critical', mandatory: isMandatory, ...result, status });
  }

  const { decision, reasons } = decide(checks, ev.problems);
  return {
    target,
    decision,
    reasons,
    checks,
    problems: ev.problems,
    release: {
      ...(ev.manifest?.version ? { version: String(ev.manifest.version) } : {}),
      ...(ev.manifest?.changeRecord ? { changeRecord: String(ev.manifest.changeRecord) } : {}),
      ...(ev.manifest?.project ? { project: String(ev.manifest.project) } : {}),
    },
    evidenceDir: ev.dir,
    today,
  };
}

/**
 * Red: a failed Blocker/Critical check, a missing mandatory check or unreadable evidence.
 * Amber: a warning or a failed Major/Minor check. Green: everything else.
 * @param {ReportedCheck[]} checks
 * @param {string[]} [problems]
 * @returns {{ decision: Decision, reasons: string[] }}
 */
export function decide(checks, problems = []) {
  /** @type {string[]} */
  const red = problems.map((p) => `Unreadable evidence: ${p}`);
  /** @type {string[]} */
  const amber = [];
  for (const c of checks) {
    if (c.status === 'missing') red.push(`${c.id} mandatory evidence missing: ${c.detail}`);
    else if (c.status === 'fail' && (c.severity === 'blocker' || c.severity === 'critical')) red.push(`${c.id} failed (${c.severity}): ${c.detail}`);
    else if (c.status === 'fail') amber.push(`${c.id} failed (${c.severity}): ${c.detail}`);
    else if (c.status === 'warn') amber.push(`${c.id} warning: ${c.detail}`);
  }
  if (red.length) return { decision: 'RED', reasons: [...red, ...amber] };
  if (amber.length) return { decision: 'AMBER', reasons: amber };
  return { decision: 'GREEN', reasons: [] };
}
