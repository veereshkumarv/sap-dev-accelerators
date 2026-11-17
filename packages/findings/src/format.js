import { compareSeverity } from './severity.js';

/**
 * Human-readable console report, most severe first.
 * @param {import('./finding.js').Finding[]} findings
 */
export function formatText(findings) {
  if (findings.length === 0) return 'No findings.';
  const sorted = [...findings].sort(
    (a, b) =>
      compareSeverity(a.severity, b.severity) ||
      (a.location?.file ?? '').localeCompare(b.location?.file ?? '') ||
      (a.location?.line ?? 0) - (b.location?.line ?? 0),
  );
  const lines = sorted.map((f) => {
    const where = f.location ? `${f.location.file}${f.location.line ? `:${f.location.line}` : ''}` : (f.object ?? '-');
    const exempt = f.exemption ? ` [exempted ${f.exemption.id} until ${f.exemption.expires}]` : '';
    return `${f.severity.toUpperCase().padEnd(8)} ${f.ruleId.padEnd(18)} ${where}  ${f.message}${exempt}`;
  });
  /** @type {Record<string, number>} */
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const summary = Object.entries(counts)
    .sort(([a], [b]) => compareSeverity(/** @type {any} */ (a), /** @type {any} */ (b)))
    .map(([s, n]) => `${n} ${s}`)
    .join(', ');
  return `${lines.join('\n')}\n\n${findings.length} finding(s): ${summary}`;
}
