/**
 * Severity scale shared by every accelerator. Ordered from most to least severe.
 * Blocker and Critical findings fail quality gates.
 *
 * @typedef {'blocker' | 'critical' | 'major' | 'minor'} Severity
 */

/** @type {readonly Severity[]} */
export const SEVERITIES = Object.freeze(['blocker', 'critical', 'major', 'minor']);

/**
 * @param {unknown} value
 * @returns {value is Severity}
 */
export function isSeverity(value) {
  return typeof value === 'string' && SEVERITIES.includes(/** @type {Severity} */ (value));
}

/**
 * 0 is the most severe.
 * @param {Severity} severity
 */
export function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  if (rank < 0) throw new TypeError(`Unknown severity: ${String(severity)}`);
  return rank;
}

/**
 * Sort comparator: most severe first.
 * @param {Severity} a
 * @param {Severity} b
 */
export function compareSeverity(a, b) {
  return severityRank(a) - severityRank(b);
}

/**
 * True for severities that must stop a pipeline (Blocker, Critical).
 * @param {Severity} severity
 */
export function isBlocking(severity) {
  return severityRank(severity) <= severityRank('critical');
}

/**
 * @param {Severity} severity
 * @returns {'error' | 'warning' | 'note'}
 */
export function toSarifLevel(severity) {
  switch (severity) {
    case 'blocker':
    case 'critical':
      return 'error';
    case 'major':
      return 'warning';
    case 'minor':
      return 'note';
    default:
      throw new TypeError(`Unknown severity: ${String(severity)}`);
  }
}

/**
 * Best-effort mapping for third-party SARIF that carries no explicit severity.
 * @param {string | undefined} level
 * @returns {Severity}
 */
export function fromSarifLevel(level) {
  switch (level) {
    case 'error':
      return 'critical';
    case 'warning':
    case undefined:
      return 'major';
    default:
      return 'minor';
  }
}
