/**
 * What: Creates and validates findings and computes their line-independent fingerprint.
 * Why: Validation surfaces tool bugs immediately; stable fingerprints let baselines survive
 *     unrelated line moves.
 * If missing or unlinked: No tool can emit findings; with a broken fingerprint every edit would
 *     turn legacy findings into "new" blockers.
 */
import { createHash } from 'node:crypto';
import { isSeverity } from './severity.js';

/**
 * @typedef {import('./severity.js').Severity} Severity
 *
 * @typedef {object} Location
 * @property {string} file    Repository-relative POSIX path.
 * @property {number} [line]  1-based.
 * @property {number} [column] 1-based.
 *
 * @typedef {object} ExemptionRef
 * @property {string} id
 * @property {string} owner
 * @property {string} expires  ISO date (YYYY-MM-DD).
 * @property {string} justification
 *
 * @typedef {object} Finding
 * @property {string} ruleId       Policy rule id, e.g. "CAP-AUTH-001".
 * @property {Severity} severity
 * @property {string} message      Must not contain line numbers (keeps fingerprints stable).
 * @property {string} tool         Emitting tool, e.g. "cap-policy-lint".
 * @property {Location} [location]
 * @property {string} [object]     Logical object, e.g. "CatalogService.Books" or "CLAS ZCL_FOO".
 * @property {string} fingerprint  Stable identity used for baseline comparison.
 * @property {ExemptionRef} [exemption] Set when an active exemption covers the finding.
 * @property {boolean} [baselineable]   False when the finding must block even if it is in the baseline.
 *
 * @typedef {Omit<Finding, 'fingerprint'> & { fingerprint?: string }} FindingInput
 */

export const RULE_ID_PATTERN = /^[A-Z][A-Z0-9]*(-[A-Z0-9_]+)+$/;

/**
 * @param {string} file
 */
export function normalisePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Fingerprint ignores line/column so that unrelated edits do not turn existing
 * findings into "new" ones.
 * @param {{ ruleId: string, object?: string, location?: Location, message: string }} f
 */
export function computeFingerprint(f) {
  const parts = [f.ruleId, f.object ?? '', f.location ? normalisePath(f.location.file) : '', f.message.trim().replace(/\s+/g, ' ')];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

/**
 * Validates and normalises a finding. Throws TypeError on invalid input so that
 * tool bugs surface immediately instead of producing unreadable reports.
 * @param {FindingInput} input
 * @returns {Finding}
 */
export function createFinding(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Finding must be an object');
  const { ruleId, severity, message, tool } = input;
  if (typeof ruleId !== 'string' || !RULE_ID_PATTERN.test(ruleId)) {
    throw new TypeError(`Invalid ruleId: ${String(ruleId)}`);
  }
  if (!isSeverity(severity)) throw new TypeError(`Invalid severity for ${ruleId}: ${String(severity)}`);
  if (typeof message !== 'string' || message.trim() === '') throw new TypeError(`Missing message for ${ruleId}`);
  if (typeof tool !== 'string' || tool === '') throw new TypeError(`Missing tool for ${ruleId}`);

  /** @type {Finding} */
  const finding = { ruleId, severity, message: message.trim(), tool, fingerprint: '' };
  if (input.location) {
    const { file, line, column } = input.location;
    if (typeof file !== 'string' || file === '') throw new TypeError(`Invalid location.file for ${ruleId}`);
    /** @type {Location} */
    const location = { file: normalisePath(file) };
    if (line !== undefined) location.line = positiveInt(line, 'line', ruleId);
    if (column !== undefined) location.column = positiveInt(column, 'column', ruleId);
    finding.location = location;
  }
  if (input.object !== undefined) finding.object = String(input.object);
  if (input.exemption) finding.exemption = { ...input.exemption };
  if (input.baselineable !== undefined) finding.baselineable = Boolean(input.baselineable);
  finding.fingerprint = input.fingerprint ?? computeFingerprint(finding);
  return finding;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {string} ruleId
 */
function positiveInt(value, name, ruleId) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < 1) {
    throw new TypeError(`Invalid location.${name} for ${ruleId}: ${String(value)}`);
  }
  return /** @type {number} */ (value);
}
