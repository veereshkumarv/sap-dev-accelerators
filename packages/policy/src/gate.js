/**
 * What: Central quality gate: merges SARIF from all tools, re-applies policy, compares to the
 *     baseline, returns pass/fail.
 * Why: One final decision point for CI, independent of which tools produced the findings.
 * If missing or unlinked: sapdx-gate cannot run; pipelines lose their single blocking step for
 *     new Blocker/Critical findings.
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
  createBaseline,
  evaluateGate,
  formatText,
  fromSarif,
  parseBaseline,
  toSarif,
} from '@sapdx/findings';
import { applyPolicy, isoToday } from './apply.js';
import { loadPolicy, resolvePolicyDir } from './load.js';

/**
 * @typedef {object} GateOptions
 * @property {string[]} sarifFiles     SARIF logs from any tool.
 * @property {string} [policyDir]
 * @property {string} [baselineFile]   Existing baseline to compare against.
 * @property {string} [writeBaseline]  Write a new baseline from current findings (does not gate).
 * @property {string} [out]            Write merged, policy-applied SARIF here.
 * @property {string} [today]          Override current date (YYYY-MM-DD) for reproducible runs.
 * @property {string} [cwd]
 */

/**
 * Central quality gate: merges SARIF from all tools, re-applies the central
 * policy and fails on new non-exempted Blocker/Critical findings.
 * Exit codes: 0 passed, 1 gate failed.
 * @param {GateOptions} options
 * @returns {Promise<{ exitCode: 0 | 1, report: string }>}
 */
export async function runGate(options) {
  const { sarifFiles, baselineFile, writeBaseline, out, today = isoToday(), cwd = process.cwd() } = options;
  if (!sarifFiles.length) throw new Error('No SARIF files given');
  const policy = await loadPolicy(await resolvePolicyDir(options.policyDir, cwd));

  const raw = [];
  for (const file of sarifFiles) {
    raw.push(...fromSarif(JSON.parse(await readFile(file, 'utf8'))));
  }
  const { findings } = applyPolicy(raw, policy, { today });

  if (out) {
    const sarif = toSarif(findings, {
      tool: { name: 'sapdx-gate' },
      rules: policy.rules.filter((r) => !r.id.endsWith('*')),
    });
    await writeFile(out, `${JSON.stringify(sarif, null, 2)}\n`);
  }

  if (writeBaseline) {
    await writeFile(writeBaseline, `${JSON.stringify(createBaseline(findings, { createdAt: today }), null, 2)}\n`);
    return { exitCode: 0, report: `Baseline with ${findings.length} finding(s) written to ${writeBaseline}.` };
  }

  const baseline = baselineFile ? parseBaseline(JSON.parse(await readFile(baselineFile, 'utf8'))) : undefined;
  const result = evaluateGate(findings, { baseline });
  const lines = [
    formatText(result.introduced),
    '',
    `New: ${result.introduced.length}, accepted by baseline: ${result.existing.length}, resolved since baseline: ${result.resolvedCount}.`,
    result.passed
      ? 'GATE PASSED: no new Blocker/Critical findings.'
      : `GATE FAILED: ${result.blocking.length} new Blocker/Critical finding(s) must be fixed or formally exempted.`,
  ];
  return { exitCode: result.passed ? 0 : 1, report: lines.join('\n') };
}
