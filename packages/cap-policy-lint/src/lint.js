/**
 * What: Orchestrates a CAP lint run: loads policy and project, runs all rule checks, applies
 *     policy, evaluates the gate.
 * Why: Central place that guarantees every CAP rule runs and results always go through the
 *     central policy.
 * If missing or unlinked: No CAP rules run; cap-policy-lint fails to start.
 */
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { createFinding, evaluateGate } from '@sapdx/findings';
import { applyPolicy, loadPolicy, resolvePolicyDir } from '@sapdx/policy';
import { loadProject } from './project.js';
import { checkApiMetadata, checkAuthorization, checkNaming, checkTests } from './rules/model.js';
import { checkServerCode } from './rules/code.js';
import { checkRemoteServices, checkSecrets } from './rules/config.js';

export const TOOL = 'cap-policy-lint';

/**
 * @typedef {import('@sapdx/findings').Finding} Finding
 * @typedef {import('@sapdx/findings').Baseline} Baseline
 * @typedef {import('@sapdx/policy').Policy} Policy
 *
 * @typedef {object} ReportOptions
 * @property {string} [object]
 * @property {{ file: string, line?: number, column?: number }} [location]
 *
 * @typedef {object} RuleContext
 * @property {import('./project.js').Project} project
 * @property {Policy} policy
 * @property {(ruleId: string, message: string, options?: ReportOptions) => void} report
 */

/** Rule checks in execution order. Each may report findings for several rule ids. */
export const CHECKS = [checkAuthorization, checkNaming, checkTests, checkApiMetadata, checkServerCode, checkRemoteServices, checkSecrets];

/**
 * Lints a CAP project against the central policy. Parses only; never executes
 * project code.
 * @param {string} dir
 * @param {{ policyDir?: string, policy?: Policy, baseline?: Baseline, today?: string }} [options]
 */
export async function lintProject(dir, options = {}) {
  // Real path: the CDS compiler reports resolved locations, so a symlinked root
  // would make every definition look external and silently hide findings.
  const root = await realpath(path.resolve(dir));
  const policy = options.policy ?? (await loadPolicy(await resolvePolicyDir(options.policyDir, root)));
  const project = await loadProject(root);

  /** @type {Finding[]} */
  const raw = [];
  /** @type {RuleContext['report']} */
  const report = (ruleId, message, opts = {}) => {
    raw.push(
      createFinding({
        ruleId,
        severity: policy.ruleFor(ruleId)?.severity ?? 'major',
        message,
        tool: TOOL,
        ...(opts.object ? { object: opts.object } : {}),
        ...(opts.location ? { location: opts.location } : {}),
      }),
    );
  };
  for (const check of CHECKS) await check({ project, policy, report });

  const { findings } = applyPolicy(raw, policy, { today: options.today, unusedScope: ['CAP-'] });
  return { findings, gate: evaluateGate(findings, { baseline: options.baseline }), policy };
}
