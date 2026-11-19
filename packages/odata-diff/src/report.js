/**
 * What: Turns API changes into policy findings (central severities and exemptions), evaluates the
 *     gate and builds the JSON/text report including the semantic-version recommendation.
 * Why: API compatibility results must be gated, exempted and baselined exactly like every other
 *     finding, and the readiness checker consumes the JSON report.
 * If missing or unlinked: odata-diff can compare models but cannot report or gate the result.
 */
import { createFinding, evaluateGate, formatText } from '@sapdx/findings';
import { applyPolicy } from '@sapdx/policy';
import { diffServiceModels, recommendBump } from './diff.js';

export const TOOL = 'odata-diff';

/**
 * @param {import('@sapdx/sap-metadata').ServiceModel} before
 * @param {import('@sapdx/sap-metadata').ServiceModel} after
 * @param {{ policy: import('@sapdx/policy').Policy, today?: string }} options
 */
export function compareApis(before, after, { policy, today }) {
  const changes = diffServiceModels(before, after);
  const raw = changes.map((c) =>
    createFinding({ ruleId: c.ruleId, severity: policy.ruleFor(c.ruleId)?.severity ?? 'critical', message: c.message, object: c.object, tool: TOOL }),
  );
  const { findings } = applyPolicy(raw, policy, { today });
  const gate = evaluateGate(findings);
  const breaking = findings.filter((f) => f.ruleId.startsWith('ODATA-BRK-'));
  return {
    findings,
    gate,
    summary: {
      recommendation: recommendBump(changes),
      breaking: breaking.length,
      breakingExempted: breaking.filter((f) => f.exemption).length,
      additive: findings.length - breaking.length,
    },
  };
}

/**
 * @param {ReturnType<typeof compareApis>} result
 */
export function toJsonReport(result) {
  return {
    tool: TOOL,
    ...result.summary,
    gate: result.gate.passed ? 'passed' : 'failed',
    findings: result.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, object: f.object, message: f.message, ...(f.exemption ? { exemption: f.exemption.id } : {}) })),
  };
}

/**
 * @param {ReturnType<typeof compareApis>} result
 */
export function toText(result) {
  const s = result.summary;
  const verdict =
    s.recommendation === 'major'
      ? `BREAKING: ${s.breaking} breaking change(s) - consumers break; release only as a new major API version.`
      : s.recommendation === 'minor'
        ? `Compatible: ${s.additive} additive change(s) - bump the minor API version.`
        : 'No API changes.';
  return `${result.findings.length ? formatText(result.findings) : 'No differences.'}\n\n${verdict}\n${result.gate.passed ? 'GATE PASSED' : `GATE FAILED: ${result.gate.blocking.length} breaking change(s) not exempted`}`;
}
