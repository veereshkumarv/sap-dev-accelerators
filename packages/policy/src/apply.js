/**
 * What: Applies the policy to raw findings: catalog severity, disabled rules, governed
 *     exemptions, expired/unused exemption findings.
 * Why: Makes the catalog authoritative and ensures only approved, unexpired exemptions suppress
 *     findings.
 * If missing or unlinked: Tool-proposed severities and third-party in-source suppressions would
 *     be trusted; expired exemptions would go unnoticed.
 */
import picomatch from 'picomatch';
import { createFinding } from '@sapdx/findings';

/**
 * @typedef {import('@sapdx/findings').Finding} Finding
 * @typedef {import('./load.js').Policy} Policy
 * @typedef {import('./load.js').Exemption} Exemption
 */

/** @returns {string} Today's date as YYYY-MM-DD (UTC). */
export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Applies the central policy to raw tool findings:
 *  - severity and baselineable come from the rule catalog (policy wins over tools)
 *  - disabled rules are dropped
 *  - exemptions are recomputed from exemptions.yaml; suppressions from other
 *    sources are discarded so only governed exemptions count
 *  - an expired exemption whose finding still exists raises POL-EXEMPT-001
 *  - optionally, unused exemptions in scope raise POL-EXEMPT-002
 *
 * @param {Finding[]} findings
 * @param {Policy} policy
 * @param {{ today?: string, unusedScope?: string[] }} [options]
 *   unusedScope: rule-id prefixes (e.g. ["CAP-"]) whose unmatched exemptions are reported.
 * @returns {{ findings: Finding[], expired: Exemption[], unused: Exemption[] }}
 */
export function applyPolicy(findings, policy, { today = isoToday(), unusedScope } = {}) {
  const matchers = policy.exemptions.map((e) => ({ exemption: e, matches: exemptionMatcher(e) }));
  /** @type {Set<Exemption>} */
  const used = new Set();
  /** @type {Set<Exemption>} */
  const expired = new Set();
  /** @type {Finding[]} */
  const out = [];

  for (const f of findings) {
    const rule = policy.ruleFor(f.ruleId);
    if (rule?.enabled === false) continue;
    const hits = matchers.filter((m) => m.matches(f)).map((m) => m.exemption);
    hits.forEach((e) => used.add(e));
    const active = hits.find((e) => e.expires >= today);
    hits.filter((e) => e.expires < today).forEach((e) => expired.add(e));

    const { exemption: _governedBelow, ...rest } = f;
    const baselineable = rule?.baselineable ?? f.baselineable;
    out.push(
      createFinding({
        ...rest,
        severity: rule?.severity ?? f.severity,
        ...(baselineable === undefined ? {} : { baselineable }),
        ...(active
          ? { exemption: { id: active.id, owner: active.owner, expires: active.expires, justification: active.justification } }
          : {}),
      }),
    );
  }

  for (const e of expired) {
    const rule = policy.ruleFor('POL-EXEMPT-001');
    out.push(
      createFinding({
        ruleId: 'POL-EXEMPT-001',
        severity: rule?.severity ?? 'blocker',
        baselineable: false,
        tool: 'policy',
        object: e.id,
        message: `Exemption ${e.id} for ${e.rule} (${e.object ?? e.path}) expired on ${e.expires}; owner ${e.owner}, backlog ${e.backlog}. Remediate or renew with architect approval.`,
      }),
    );
  }

  const unused = unusedScope
    ? policy.exemptions.filter((e) => !used.has(e) && unusedScope.some((p) => e.rule.startsWith(p)))
    : [];
  for (const e of unused) {
    out.push(
      createFinding({
        ruleId: 'POL-EXEMPT-002',
        severity: policy.ruleFor('POL-EXEMPT-002')?.severity ?? 'minor',
        tool: 'policy',
        object: e.id,
        message: `Exemption ${e.id} for ${e.rule} no longer matches any finding; remove it from exemptions.yaml.`,
      }),
    );
  }

  return { findings: out, expired: [...expired], unused };
}

/**
 * @param {Exemption} e
 * @returns {(f: Finding) => boolean}
 */
function exemptionMatcher(e) {
  const pathMatch = e.path ? picomatch(e.path, { dot: true }) : undefined;
  return (f) => {
    if (f.ruleId !== e.rule) return false;
    if (e.object !== undefined && f.object !== e.object) return false;
    if (pathMatch && !(f.location && pathMatch(f.location.file))) return false;
    return true;
  };
}
