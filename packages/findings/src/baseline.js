/**
 * What: Baseline handling and the gate decision: which findings are new vs. accepted legacy, and
 *     whether the gate passes.
 * Why: Lets teams adopt the gates on existing code without being blocked by old debt, while never
 *     baselining secrets/modifications.
 * If missing or unlinked: Gates cannot distinguish legacy from new issues; adoption on brownfield
 *     code becomes impossible.
 */
import { isBlocking } from './severity.js';

/**
 * @typedef {import('./finding.js').Finding} Finding
 *
 * A baseline records accepted legacy findings as fingerprint -> occurrence count.
 * @typedef {object} Baseline
 * @property {1} version
 * @property {string} [createdAt]
 * @property {Record<string, number>} fingerprints
 */

/**
 * @param {Finding[]} findings
 * @param {{ createdAt?: string }} [options]
 * @returns {Baseline}
 */
export function createBaseline(findings, { createdAt } = {}) {
  /** @type {Record<string, number>} */
  const fingerprints = {};
  for (const f of findings) {
    if (f.exemption) continue;
    fingerprints[f.fingerprint] = (fingerprints[f.fingerprint] ?? 0) + 1;
  }
  return { version: 1, ...(createdAt ? { createdAt } : {}), fingerprints };
}

/**
 * @param {any} value
 * @returns {Baseline}
 */
export function parseBaseline(value) {
  if (!value || value.version !== 1 || typeof value.fingerprints !== 'object' || value.fingerprints === null) {
    throw new TypeError('Invalid baseline: expected { version: 1, fingerprints: {...} }');
  }
  for (const [fp, count] of Object.entries(value.fingerprints)) {
    if (!Number.isInteger(count) || /** @type {number} */ (count) < 1) throw new TypeError(`Invalid baseline count for ${fp}`);
  }
  return value;
}

/**
 * Splits findings into those introduced since the baseline and those already
 * accepted. Occurrences are counted, so a second copy of a known issue is new.
 * @param {Finding[]} findings
 * @param {Baseline} [baseline]
 */
export function diffBaseline(findings, baseline) {
  const remaining = new Map(Object.entries(baseline?.fingerprints ?? {}));
  /** @type {Finding[]} */
  const introduced = [];
  /** @type {Finding[]} */
  const existing = [];
  for (const f of findings) {
    const left = remaining.get(f.fingerprint) ?? 0;
    if (left > 0 && f.baselineable !== false) {
      existing.push(f);
      remaining.set(f.fingerprint, left - 1);
    } else {
      introduced.push(f);
    }
  }
  let resolvedCount = 0;
  for (const left of remaining.values()) resolvedCount += left;
  return { introduced, existing, resolvedCount };
}

/**
 * Gate decision: fails when any non-exempted Blocker/Critical finding is new
 * (or is not allowed to be baselined). Never averages severities.
 * @param {Finding[]} findings
 * @param {{ baseline?: Baseline }} [options]
 */
export function evaluateGate(findings, { baseline } = {}) {
  const { introduced, existing, resolvedCount } = diffBaseline(findings, baseline);
  const blocking = introduced.filter((f) => !f.exemption && isBlocking(f.severity));
  return { passed: blocking.length === 0, blocking, introduced, existing, resolvedCount };
}
