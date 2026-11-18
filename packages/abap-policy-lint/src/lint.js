/**
 * What: Orchestrates an ABAP clean-core lint run: loads the policy, the abapGit repository, the
 *     optional released-API catalogue and dependencies, runs abaplint plus all rules, applies the
 *     central policy and evaluates the gate.
 * Why: One entry point guarantees every rule runs and every finding goes through the central
 *     policy (severities, exemptions, baseline) like all other tools.
 * If missing or unlinked: No ABAP rules run; abap-policy-lint fails to start.
 */
import path from 'node:path';
import { createFinding, evaluateGate } from '@sapdx/findings';
import { applyPolicy, loadPolicy, resolvePolicyDir } from '@sapdx/policy';
import { buildRegistry, collectIssues, Version } from './abaplint-compat.js';
import { loadRepository } from './repo.js';
import { ABAPLINT_RULES, checkStatements, reportAbaplintIssues } from './rules/code.js';
import { checkObjects } from './rules/objects.js';

export const TOOL = 'abap-policy-lint';

/**
 * @typedef {import('@sapdx/findings').Finding} Finding
 * @typedef {import('@sapdx/findings').Baseline} Baseline
 * @typedef {import('@sapdx/policy').Policy} Policy
 * @typedef {import('./released.js').ReleasedApis} ReleasedApis
 *
 * @typedef {object} RuleContext
 * @property {import('@abaplint/core').IRegistry} registry
 * @property {Policy} policy
 * @property {ReleasedApis | undefined} released
 * @property {(name: string) => boolean} isCustomer
 * @property {(file: string) => string} objectOfFile
 * @property {(ruleId: string, message: string, options?: { object?: string, location?: { file: string, line?: number } }) => void} report
 *
 * @typedef {object} LintOptions
 * @property {string} [policyDir]
 * @property {Policy} [policy]
 * @property {Baseline} [baseline]
 * @property {string} [today]
 * @property {string} [version]        abaplint language version, default Cloud (e.g. v758 for on-premise)
 * @property {ReleasedApis} [released] released-API catalogue; without it ABAP-CC-001/005 are skipped
 * @property {Array<{ path: string, content: string }>} [dependencies]
 */

export const VERSIONS = Object.values(Version);

/**
 * @param {string} dir  abapGit repository root
 * @param {LintOptions} [options]
 */
export async function lintRepository(dir, options = {}) {
  const repo = await loadRepository(dir);
  const policy = options.policy ?? (await loadPolicy(await resolvePolicyDir(options.policyDir, repo.root)));
  const version = options.version ?? Version.Cloud;
  if (!VERSIONS.includes(/** @type {any} */ (version))) throw new TypeError(`Unknown ABAP version "${version}" (use one of ${VERSIONS.join(', ')})`);

  const { registry, normalized } = buildRegistry(repo.files, { version, rules: ABAPLINT_RULES, dependencies: options.dependencies ?? [] });
  const { issues, knownGaps, unverified } = collectIssues(registry, normalized);

  const prefix = String(policy.naming?.abap?.prefix ?? 'Z').toUpperCase();
  const isCustomer = (/** @type {string} */ name) => {
    const n = name.toUpperCase();
    return n.startsWith('Z') || n.startsWith('Y') || n.startsWith(prefix) || /^\/[A-Z0-9]+\//.test(n) && n.startsWith(prefix);
  };
  /** @type {Map<string, string>} */
  const fileToObject = new Map();
  for (const obj of registry.getObjects()) {
    for (const f of obj.getFiles()) fileToObject.set(f.getFilename().replace(/^\//, ''), `${obj.getType()} ${obj.getName()}`);
  }

  /** @type {Finding[]} */
  const raw = [];
  /** @type {RuleContext} */
  const ctx = {
    registry,
    policy,
    released: options.released,
    isCustomer,
    objectOfFile: (file) => fileToObject.get(file) ?? path.basename(file),
    report: (ruleId, message, opts = {}) => {
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
    },
  };

  reportAbaplintIssues(ctx, issues);
  checkStatements(ctx);
  checkObjects(ctx);

  const { findings } = applyPolicy(raw, policy, { today: options.today, unusedScope: ['ABAP-'] });
  return {
    findings,
    gate: evaluateGate(findings, { baseline: options.baseline }),
    policy,
    info: {
      root: repo.root,
      startingFolder: repo.startingFolder,
      objects: registry.getObjectCount().normal,
      version,
      releasedApis: options.released ? `${options.released.variant} (${options.released.size} objects)` : undefined,
      normalized,
      knownGaps,
      unverified,
    },
  };
}
