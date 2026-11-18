/**
 * What: Command-line interface of rap-scaffold: reads the model, generates the abapGit files,
 *     verifies them with abaplint (default) and writes them; exit codes 0 ok, 1 verification
 *     failed, 2 usage/model/overwrite error.
 * Why: Developers and pipelines need a stable contract; the logic is separate from the bin file
 *     so it can be unit tested.
 * If missing or unlinked: The rap-scaffold command cannot start.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadPolicy, resolvePolicyDir } from '@sapdx/policy';
import { ModelError, parseModelText } from './model.js';
import { scaffold, writeFiles } from './scaffold.js';
import { verifyFiles } from './verify.js';

export const USAGE = `Usage: rap-scaffold --model <file.yaml> --out <dir> [options]

Generates a clean-core RAP business object (ABAP Cloud) in abapGit format:
tables, CDS views, access controls, behavior definitions, behavior pool with
ABAP Unit tests, UI annotations, service definition and binding.

Options:
  --model <file>     BO model (YAML or JSON), see examples/sales-order.yaml
  --out <dir>        Target folder (abapGit repository root)
  --policy <dir>     Policy directory (default: nearest ./policy or bundled)
  --deps <dir>       Existing abapGit repository with objects the model references
                     (e.g. data elements); repeatable, used for verification only
  --force            Overwrite existing files
  --no-verify        Skip the abaplint verification
  -h, --help

Exit codes: 0 generated, 1 verification failed (nothing written), 2 usage, model or overwrite error`;

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        model: { type: 'string' },
        out: { type: 'string' },
        policy: { type: 'string' },
        deps: { type: 'string', multiple: true },
        force: { type: 'boolean' },
        'no-verify': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (err) {
    stderr(`rap-scaffold: ${/** @type {Error} */ (err).message}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    stdout(USAGE);
    return 0;
  }
  if (!values.model || !values.out) {
    stderr(`rap-scaffold: --model and --out are required\n\n${USAGE}`);
    return 2;
  }

  try {
    const policy = await loadPolicy(await resolvePolicyDir(values.policy));
    if (!policy.naming) throw new ModelError('Policy has no naming.yaml; cannot derive RAP object names');
    const { model, files } = scaffold(parseModelText(await readFile(values.model, 'utf8')), policy.naming);

    if (!values['no-verify']) {
      const dependencies = [];
      for (const dir of values.deps ?? []) dependencies.push(...(await readTree(dir)));
      const result = verifyFiles(files, { dependencies });
      for (const n of result.normalized) stdout(`  note: ${n.file}: ${n.count}x "${n.gap}" normalised for abaplint (grammar gap; file unchanged)`);
      for (const g of result.knownGaps) stdout(`  note: ${g.file}:${g.line}: known abaplint gap (${g.gap})`);
      if (result.issues.length) {
        for (const i of result.issues) stderr(`  ${i.file}:${i.line} [${i.rule}] ${i.message}`);
        stderr(`rap-scaffold: verification failed with ${result.issues.length} issue(s); nothing was written.`);
        return 1;
      }
      stdout(`Verified ${result.objects} objects with abaplint (ABAP Cloud): no issues.`);
      if (result.unverified.length) stdout(`  not syntax-checked offline (no abaplint parser; checked on activation): ${result.unverified.join(', ')}`);
    }

    await writeFiles(files, path.resolve(values.out), { force: values.force });
    stdout(`Generated ${model.root.names.baseView}: ${files.length} files in ${values.out}`);
    stdout(`Next: create authorization object ${model.authorizationObject} (field ACTVT), pull with abapGit into ${model.package}, activate, publish ${model.root.names.serviceBinding}.`);
    return 0;
  } catch (err) {
    stderr(`rap-scaffold: ${/** @type {Error} */ (err).message}`);
    return 2;
  }
}

/**
 * All abapGit files below a directory (relative paths).
 * @param {string} dir
 */
async function readTree(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || !/\.(abap|xml|asddls|asdcls|asbdef|srvdsrv|asddlxs)$/.test(e.name)) continue;
    const full = path.join(e.parentPath, e.name);
    files.push({ path: path.relative(dir, full).replaceAll('\\', '/'), content: await readFile(full, 'utf8') });
  }
  return files;
}
