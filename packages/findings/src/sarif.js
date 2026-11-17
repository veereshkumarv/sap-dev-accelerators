import { createFinding } from './finding.js';
import { fromSarifLevel, isSeverity, toSarifLevel } from './severity.js';

/**
 * @typedef {import('./finding.js').Finding} Finding
 *
 * @typedef {object} RuleMeta
 * @property {string} id
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [helpUri]
 * @property {import('./severity.js').Severity} [severity]
 *
 * @typedef {object} ToolMeta
 * @property {string} name
 * @property {string} [version]
 * @property {string} [informationUri]
 */

export const FINGERPRINT_KEY = 'sapdx/v1';

/**
 * Converts findings into a SARIF 2.1.0 log (one run). Exempted findings are
 * emitted with an accepted external suppression so code-scanning UIs hide them.
 * @param {Finding[]} findings
 * @param {{ tool: ToolMeta, rules?: RuleMeta[] }} options
 */
export function toSarif(findings, { tool, rules = [] }) {
  const ruleMap = new Map(rules.map((r) => [r.id, r]));
  for (const f of findings) {
    if (!ruleMap.has(f.ruleId)) ruleMap.set(f.ruleId, { id: f.ruleId, severity: f.severity });
  }
  const sortedRules = [...ruleMap.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: tool.name,
            ...(tool.version ? { version: tool.version } : {}),
            ...(tool.informationUri ? { informationUri: tool.informationUri } : {}),
            rules: sortedRules.map((r) => ({
              id: r.id,
              ...(r.title ? { shortDescription: { text: r.title } } : {}),
              ...(r.description ? { fullDescription: { text: r.description } } : {}),
              ...(r.helpUri ? { helpUri: r.helpUri } : {}),
              ...(r.severity
                ? { defaultConfiguration: { level: toSarifLevel(r.severity) }, properties: { severity: r.severity } }
                : {}),
            })),
          },
        },
        results: findings.map(toResult),
      },
    ],
  };
}

/**
 * @param {Finding} f
 */
function toResult(f) {
  /** @type {Record<string, unknown>} */
  const result = {
    ruleId: f.ruleId,
    level: toSarifLevel(f.severity),
    message: { text: f.message },
    partialFingerprints: { [FINGERPRINT_KEY]: f.fingerprint },
    properties: {
      severity: f.severity,
      tool: f.tool,
      ...(f.object ? { object: f.object } : {}),
      ...(f.baselineable === false ? { baselineable: false } : {}),
    },
  };
  if (f.location) {
    /** @type {Record<string, number>} */
    const region = {};
    if (f.location.line) region.startLine = f.location.line;
    if (f.location.column) region.startColumn = f.location.column;
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: f.location.file },
          ...(Object.keys(region).length ? { region } : {}),
        },
      },
    ];
  }
  if (f.exemption) {
    result.suppressions = [
      {
        kind: 'external',
        status: 'accepted',
        justification: `${f.exemption.id}: ${f.exemption.justification} (owner ${f.exemption.owner}, expires ${f.exemption.expires})`,
      },
    ];
    /** @type {Record<string, unknown>} */ (result.properties).exemption = f.exemption;
  }
  return result;
}

/**
 * Reads findings from any SARIF 2.1.0 log, including third-party tools
 * (gitleaks, CodeQL, ...). Severity comes from properties.severity when present,
 * otherwise from the SARIF level. Suppressed results keep their exemption.
 * @param {any} sarif
 * @param {{ defaultTool?: string }} [options]
 * @returns {Finding[]}
 */
export function fromSarif(sarif, { defaultTool } = {}) {
  if (!sarif || !Array.isArray(sarif.runs)) throw new TypeError('Not a SARIF log: missing runs[]');
  /** @type {Finding[]} */
  const findings = [];
  for (const run of sarif.runs) {
    const toolName = run?.tool?.driver?.name ?? defaultTool ?? 'unknown';
    /** @type {Map<string, any>} */
    const rules = new Map((run?.tool?.driver?.rules ?? []).map((/** @type {any} */ r) => [r.id, r]));
    for (const r of run.results ?? []) {
      const ruleId = normaliseRuleId(r.ruleId ?? 'UNKNOWN-RULE', toolName);
      const props = r.properties ?? {};
      const ruleMeta = rules.get(r.ruleId);
      const severity = isSeverity(props.severity)
        ? props.severity
        : isSeverity(ruleMeta?.properties?.severity)
          ? ruleMeta.properties.severity
          : fromSarifLevel(r.level ?? ruleMeta?.defaultConfiguration?.level);
      const phys = r.locations?.[0]?.physicalLocation;
      const suppressed = Array.isArray(r.suppressions) && r.suppressions.some((/** @type {any} */ s) => s.status !== 'rejected');
      findings.push(
        createFinding({
          ruleId,
          severity,
          message: r.message?.text || ruleMeta?.shortDescription?.text || ruleId,
          tool: props.tool ?? toolName,
          ...(phys?.artifactLocation?.uri
            ? {
                location: {
                  file: phys.artifactLocation.uri,
                  ...(phys.region?.startLine ? { line: phys.region.startLine } : {}),
                  ...(phys.region?.startColumn ? { column: phys.region.startColumn } : {}),
                },
              }
            : {}),
          ...(props.object ? { object: props.object } : {}),
          ...(props.baselineable === false ? { baselineable: false } : {}),
          ...(r.partialFingerprints?.[FINGERPRINT_KEY] ? { fingerprint: r.partialFingerprints[FINGERPRINT_KEY] } : {}),
          ...(suppressed
            ? {
                exemption: props.exemption ?? {
                  id: 'EXTERNAL',
                  owner: 'unknown',
                  expires: '9999-12-31',
                  justification: r.suppressions[0]?.justification ?? 'suppressed in source tool',
                },
              }
            : {}),
        }),
      );
    }
  }
  return findings;
}

/**
 * Third-party rule ids (e.g. "generic-api-key") are namespaced so they satisfy
 * the policy rule-id format: "EXT-GITLEAKS-GENERIC_API_KEY".
 * @param {string} ruleId
 * @param {string} toolName
 */
export function normaliseRuleId(ruleId, toolName) {
  if (/^[A-Z][A-Z0-9]*(-[A-Z0-9_]+)+$/.test(ruleId)) return ruleId;
  const clean = (/** @type {string} */ s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';
  return `EXT-${clean(toolName)}-${clean(ruleId)}`;
}
