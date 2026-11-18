/**
 * What: Command-line interface of abap-policy-lint: the lint command (text/SARIF output, baseline,
 *     released-API catalogue, dependencies) and the update-released-apis command.
 * Why: Developers and pipelines need a stable CLI contract with exit codes 0 pass / 1 gate failed
 *     / 2 usage or configuration error; logic is separate from the bin file for testing.
 * If missing or unlinked: The abap-policy-lint command cannot start.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { formatText, parseBaseline, toSarif } from '@sapdx/findings';
import { lintRepository, TOOL, VERSIONS } from './lint.js';
import { downloadReleasedApis, loadReleasedApis, VARIANTS } from './released.js';
import { loadDependencyFiles } from './repo.js';

export const DEFAULT_RELEASED_FILE = '.sapdx/released-apis.json';

export const USAGE = `Usage:
  abap-policy-lint [repoDir] [options]          lint an abapGit/gCTS repository
  abap-policy-lint update-released-apis [opts]   download SAP's released-API list

Lint options:
  --policy <dir>            Policy directory (default: nearest ./policy or bundled)
  --released-apis <file>    Released-API cache (default: <repoDir>/${DEFAULT_RELEASED_FILE}
                            or $SAPDX_RELEASED_APIS); without it ABAP-CC-001/005 are skipped
  --deps <dir>              abapGit folder with referenced customer objects (repeatable)
  --abap-version <v>        abaplint language version (default Cloud; e.g. v758 on-premise)
  --format text|sarif       Output format (default: text)
  --out <file>              Write output to a file
  --baseline <file>         Accept findings recorded in this baseline
  --today <YYYY-MM-DD>      Override current date (exemption expiry)

update-released-apis options:
  --variant btp|public|pce  BTP ABAP Environment (default), S/4HANA Cloud Public, Private Cloud
  --out <file>              Target file (default: ${DEFAULT_RELEASED_FILE})

Exit codes: 0 gate passed, 1 new Blocker/Critical findings, 2 usage or configuration error`;

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, fetchImpl?: typeof fetch }} [io]
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
        'released-apis': { type: 'string' },
        deps: { type: 'string', multiple: true },
        'abap-version': { type: 'string' },
        format: { type: 'string', default: 'text' },
        out: { type: 'string' },
        baseline: { type: 'string' },
        today: { type: 'string' },
        variant: { type: 'string', default: 'btp' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      stdout(USAGE);
      return 0;
    }

    if (positionals[0] === 'update-released-apis') {
      if (!Object.hasOwn(VARIANTS, values.variant)) throw new Error(`--variant must be one of ${Object.keys(VARIANTS).join(', ')}`);
      const target = values.out ?? DEFAULT_RELEASED_FILE;
      const catalogue = await downloadReleasedApis(values.variant, io.fetchImpl ? { fetchImpl: io.fetchImpl } : {});
      await mkdir(path.dirname(path.resolve(target)), { recursive: true });
      await writeFile(target, `${JSON.stringify(catalogue)}\n`);
      const released = catalogue.objects.filter((o) => o[4] === 'released').length;
      stdout(`Saved ${catalogue.objects.length} SAP objects (${released} released) for "${values.variant}" to ${target}.`);
      return 0;
    }

    if (positionals.length > 1) throw new Error('Only one repository directory may be given');
    if (values.format !== 'text' && values.format !== 'sarif') throw new Error(`Unknown format: ${values.format}`);
    if (values.today && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) throw new Error('--today must be YYYY-MM-DD');
    if (values['abap-version'] && !VERSIONS.includes(/** @type {any} */ (values['abap-version']))) {
      throw new Error(`--abap-version must be one of ${VERSIONS.join(', ')}`);
    }

    const repoDir = positionals[0] ?? '.';
    const releasedFile = values['released-apis'] ?? process.env.SAPDX_RELEASED_APIS ?? (await existing(path.join(repoDir, DEFAULT_RELEASED_FILE)));
    const released = releasedFile ? await loadReleasedApis(releasedFile) : undefined;
    const dependencies = [];
    for (const dir of values.deps ?? []) dependencies.push(...(await loadDependencyFiles(dir)));
    const baseline = values.baseline ? parseBaseline(JSON.parse(await readFile(values.baseline, 'utf8'))) : undefined;

    const { findings, gate, policy, info } = await lintRepository(repoDir, {
      policyDir: values.policy,
      baseline,
      today: values.today,
      version: values['abap-version'],
      released,
      dependencies,
    });

    /** @type {string[]} */
    const notes = [];
    notes.push(`${info.objects} objects checked (abaplint, ABAP version ${info.version}).`);
    if (!info.releasedApis) notes.push('WARNING: no released-API cache - ABAP-CC-001/005 (unreleased/deprecated SAP APIs) were NOT checked. Run: abap-policy-lint update-released-apis');
    else notes.push(`Released-API catalogue: ${info.releasedApis}.`);
    for (const n of info.normalized) notes.push(`note: ${n.file}: ${n.count}x "${n.gap}" normalised for abaplint (grammar gap; file unchanged)`);
    if (info.knownGaps.length) notes.push(`note: ${info.knownGaps.length} known abaplint gap(s) ignored (${[...new Set(info.knownGaps.map((g) => g.gap))].join('; ')})`);
    if (info.unverified.length) notes.push(`note: not syntax-checked offline (no abaplint parser): ${info.unverified.join(', ')}`);

    const output =
      values.format === 'sarif'
        ? JSON.stringify(toSarif(findings, { tool: { name: TOOL, version: '0.1.0' }, rules: policy.rules.filter((r) => r.tool === TOOL && !r.id.endsWith('*')) }), null, 2)
        : `${formatText(findings)}\n\n${notes.join('\n')}\n${gate.passed ? 'GATE PASSED' : `GATE FAILED: ${gate.blocking.length} new Blocker/Critical finding(s)`}`;
    if (values.out) {
      await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
      await writeFile(values.out, `${output}\n`);
      for (const n of notes) stdout(n);
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

/** @param {string} file */
async function existing(file) {
  try {
    await access(file);
    return file;
  } catch {
    return undefined;
  }
}
