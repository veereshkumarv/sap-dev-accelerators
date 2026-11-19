/**
 * What: Command-line interface of odata-diff: compare two API versions (EDMX files, CAP projects or
 *     snapshots) and write text/JSON/SARIF, or record a snapshot of the current API.
 * Why: CI compares the pull-request state with the snapshot of the last release; developers run the
 *     same command locally. Exit codes: 0 compatible, 1 breaking (not exempted), 2 usage error.
 * If missing or unlinked: The odata-diff command cannot start.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { toSarif } from '@sapdx/findings';
import { loadPolicy, resolvePolicyDir } from '@sapdx/policy';
import { loadServiceModel } from '@sapdx/sap-metadata';
import { compareApis, TOOL, toJsonReport, toText } from './report.js';

export const USAGE = `Usage:
  odata-diff <before> <after> [options]     compare two API versions
  odata-diff snapshot <input> --out <file>  record the API of a version (e.g. at release)

<before>/<after>/<input>: $metadata EDMX file (V2/V4), CAP project folder or snapshot JSON.

Options:
  --format text|json|sarif   Output format (default: text)
  --out <file>               Write output to a file
  --policy <dir>             Policy directory (default: nearest ./policy or bundled)
  --today <YYYY-MM-DD>       Override current date (exemption expiry)

Exit codes: 0 compatible, 1 breaking changes (not exempted), 2 usage or input error`;

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
        format: { type: 'string', default: 'text' },
        out: { type: 'string' },
        policy: { type: 'string' },
        today: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      stdout(USAGE);
      return 0;
    }

    if (positionals[0] === 'snapshot') {
      if (positionals.length !== 2 || !values.out) throw new Error('snapshot needs exactly one input and --out <file>');
      const model = await loadServiceModel(positionals[1]);
      await write(values.out, `${JSON.stringify(model, null, 2)}\n`);
      const sets = model.services.reduce((n, s) => n + s.entitySets.length, 0);
      stdout(`Snapshot of ${model.services.length} service(s), ${sets} entity set(s) written to ${values.out}.`);
      return 0;
    }

    if (positionals.length !== 2) throw new Error('Exactly two inputs are required: <before> <after>');
    if (!['text', 'json', 'sarif'].includes(values.format)) throw new Error(`Unknown format: ${values.format}`);
    if (values.today && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) throw new Error('--today must be YYYY-MM-DD');

    const [before, after] = await Promise.all(positionals.map((p) => loadServiceModel(p)));
    const policy = await loadPolicy(await resolvePolicyDir(values.policy));
    const result = compareApis(before, after, { policy, today: values.today });

    const output =
      values.format === 'json'
        ? JSON.stringify(toJsonReport(result), null, 2)
        : values.format === 'sarif'
          ? JSON.stringify(toSarif(result.findings, { tool: { name: TOOL, version: '0.1.0' }, rules: policy.rules.filter((r) => r.tool === TOOL) }), null, 2)
          : toText(result);
    if (values.out) {
      await write(values.out, `${output}\n`);
      stdout(`${result.summary.breaking} breaking, ${result.summary.additive} additive change(s); recommended version bump: ${result.summary.recommendation}. Written to ${values.out}.`);
    } else {
      stdout(output);
    }
    return result.gate.passed ? 0 : 1;
  } catch (err) {
    stderr(`${TOOL}: ${/** @type {Error} */ (err).message}\n\n${USAGE}`);
    return 2;
  }
}

/**
 * @param {string} file
 * @param {string} content
 */
async function write(file, content) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, content);
}
