/**
 * What: Command-line interface: argument parsing, text/SARIF output, baseline loading and exit
 *     codes 0/1/2.
 * Why: Pipelines need a stable CLI contract; the logic is separate from the bin file so it can be
 *     unit tested.
 * If missing or unlinked: The bin script cannot start and pipelines calling cap-policy-lint fail.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { formatText, parseBaseline, toSarif } from '@sapdx/findings';
import { lintProject, TOOL } from './lint.js';

export const USAGE = `Usage: cap-policy-lint [projectDir] [options]

Clean-core, security and quality policy checks for a CAP project.

Options:
  --policy <dir>         Policy directory (default: nearest ./policy or bundled)
  --format text|sarif    Output format (default: text)
  --out <file>           Write output to file instead of stdout
  --baseline <file>      Accept findings recorded in this baseline
  --today <YYYY-MM-DD>   Override current date (exemption expiry)
  -h, --help

Exit codes: 0 gate passed, 1 new Blocker/Critical findings, 2 usage or configuration error`;

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        policy: { type: 'string' },
        format: { type: 'string', default: 'text' },
        out: { type: 'string' },
        baseline: { type: 'string' },
        today: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      stdout(USAGE);
      return 0;
    }
    if (positionals.length > 1) throw new Error('Only one project directory may be given');
    if (values.format !== 'text' && values.format !== 'sarif') throw new Error(`Unknown format: ${values.format}`);
    if (values.today && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) throw new Error('--today must be YYYY-MM-DD');

    const baseline = values.baseline ? parseBaseline(JSON.parse(await readFile(values.baseline, 'utf8'))) : undefined;
    const { findings, gate, policy } = await lintProject(positionals[0] ?? '.', {
      policyDir: values.policy,
      baseline,
      today: values.today,
    });

    const output =
      values.format === 'sarif'
        ? JSON.stringify(toSarif(findings, { tool: { name: TOOL, version: '0.1.0' }, rules: policy.rules.filter((r) => r.tool === TOOL) }), null, 2)
        : `${formatText(findings)}\n\n${gate.passed ? 'GATE PASSED' : `GATE FAILED: ${gate.blocking.length} new Blocker/Critical finding(s)`}`;
    if (values.out) {
      await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
      await writeFile(values.out, `${output}\n`);
      stdout(`${findings.length} finding(s) written to ${values.out}; gate ${gate.passed ? 'passed' : 'failed'}.`);
    } else {
      stdout(output);
    }
    return gate.passed ? 0 : 1;
  } catch (err) {
    stderr(`${TOOL}: ${/** @type {Error} */ (err).message}\n\n${USAGE}`);
    return 2;
  }
}
