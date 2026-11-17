/**
 * What: Public entry point of @sapdx/findings: re-exports severity, finding, SARIF, baseline and
 *     text-format helpers plus shared types.
 * Why: Consumers import from one stable path instead of internal files, so internals can change
 *     safely.
 * If missing or unlinked: import "@sapdx/findings" fails in every tool, and shared JSDoc types
 *     (Finding, Severity) become unresolved.
 */
/**
 * @typedef {import('./severity.js').Severity} Severity
 * @typedef {import('./finding.js').Finding} Finding
 * @typedef {import('./finding.js').FindingInput} FindingInput
 * @typedef {import('./finding.js').Location} Location
 * @typedef {import('./finding.js').ExemptionRef} ExemptionRef
 * @typedef {import('./baseline.js').Baseline} Baseline
 * @typedef {import('./sarif.js').RuleMeta} RuleMeta
 */

export {
  SEVERITIES,
  isSeverity,
  severityRank,
  compareSeverity,
  isBlocking,
  toSarifLevel,
  fromSarifLevel,
} from './severity.js';
export { RULE_ID_PATTERN, createFinding, computeFingerprint, normalisePath } from './finding.js';
export { FINGERPRINT_KEY, toSarif, fromSarif, normaliseRuleId } from './sarif.js';
export { createBaseline, parseBaseline, diffBaseline, evaluateGate } from './baseline.js';
export { formatText } from './format.js';
