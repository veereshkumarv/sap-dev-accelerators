/**
 * What: Renders a readiness assessment as plain text (terminal / CI log), JSON (machines, dashboards)
 *     or Markdown (pull-request comment, change record attachment).
 * Why: Release managers, CI and change-advisory boards read the same decision in the format they
 *     use; the content is identical across formats.
 * If missing or unlinked: The CLI cannot print or write the decision; only the exit code remains.
 */

/** @typedef {import('./readiness.js').Assessment} Assessment */

const ICON = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', missing: 'MISSING', skipped: 'skipped', 'n/a': 'n/a' };

/** @param {Assessment} a */
export function toText(a) {
  const width = Math.max(...a.checks.map((c) => c.id.length));
  const lines = [
    `Release readiness for ${a.target}${a.release.version ? ` - version ${a.release.version}` : ''}${a.release.changeRecord ? ` (${a.release.changeRecord})` : ''}`,
    '',
    ...a.checks.map((c) => `${ICON[c.status].padEnd(7)} ${c.id.padEnd(width)} ${c.mandatory ? '*' : ' '} ${c.detail}`),
    '',
    '* mandatory for this target',
  ];
  if (a.reasons.length) lines.push('', 'Reasons:', ...a.reasons.map((r) => `  - ${r}`));
  lines.push('', `DECISION: ${a.decision}`);
  return lines.join('\n');
}

/** @param {Assessment} a */
export function toJson(a) {
  return {
    tool: 'sapdx-readiness',
    target: a.target,
    decision: a.decision,
    date: a.today,
    release: a.release,
    reasons: a.reasons,
    problems: a.problems,
    checks: a.checks.map(({ id, title, severity, mandatory, status, detail, evidence }) => ({ id, title, severity, mandatory, status, detail, evidence })),
  };
}

/** @param {Assessment} a */
export function toMarkdown(a) {
  const badge = { GREEN: '🟢 GREEN', AMBER: '🟠 AMBER', RED: '🔴 RED' }[a.decision];
  const cell = (/** @type {string} */ s) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = [
    `## Release readiness: ${badge}`,
    '',
    `Target **${a.target}**${a.release.version ? `, version **${a.release.version}**` : ''}${a.release.changeRecord ? `, change record **${a.release.changeRecord}**` : ''}, assessed ${a.today}.`,
    '',
    '| Check | Status | Severity | Mandatory | Detail |',
    '|---|---|---|---|---|',
    ...a.checks.map((c) => `| ${c.id} ${cell(c.title)} | ${ICON[c.status]} | ${c.severity} | ${c.mandatory ? 'yes' : 'no'} | ${cell(c.detail)} |`),
  ];
  if (a.reasons.length) lines.push('', '### Reasons', '', ...a.reasons.map((r) => `- ${cell(r)}`));
  return lines.join('\n');
}
