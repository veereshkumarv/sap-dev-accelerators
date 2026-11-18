/**
 * What: Command-line interface of create-cap-app: parses arguments, calls generate() and maps
 *     errors to exit codes (0 ok, 1 generation failed, 2 usage/target error).
 * Why: Developers and the self-service portal need a stable CLI contract; the logic is separate from
 *     the bin file so it can be unit tested.
 * If missing or unlinked: The create-cap-app command cannot start.
 */
import { parseArgs } from 'node:util';
import { generate, TargetError } from './generate.js';
import { DEFAULTS, OptionsError } from './options.js';

export const USAGE = `Usage: create-cap-app <name> [options]

Generates a CAP project on the organisation golden path: SAP cds init/add plus
secure service template, tests, CI pipeline, docs and policy gate.

Options:
  --dir <parent>             Parent directory (default: current directory)
  --namespace <ns>           CDS namespace (default: ${DEFAULTS.namespace})
  --entity <Name>            Root entity, plural PascalCase (default: ${DEFAULTS.entity})
  --db hana|postgres         Database (default: ${DEFAULTS.db})
  --target cf                Deployment target (default: ${DEFAULTS.target}; kyma not yet supported)
  --tenancy single           Tenancy (default: ${DEFAULTS.tenancy}; multi not yet supported)
  --policy <dir>             Policy directory (default: nearest ./policy or bundled)
  --sapdx-source <src>       "registry" (default) or path to the sap-dev-accelerators repo
  --skip-install             Do not run npm install
  -h, --help

Exit codes: 0 generated, 1 generation failed, 2 usage error or target not empty`;

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        dir: { type: 'string' },
        namespace: { type: 'string' },
        entity: { type: 'string' },
        db: { type: 'string' },
        target: { type: 'string' },
        tenancy: { type: 'string' },
        policy: { type: 'string' },
        'sapdx-source': { type: 'string' },
        'skip-install': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (err) {
    stderr(`create-cap-app: ${/** @type {Error} */ (err).message}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    stdout(USAGE);
    return 0;
  }
  if (positionals.length !== 1) {
    stderr(`create-cap-app: exactly one project name is required\n\n${USAGE}`);
    return 2;
  }
  try {
    const { root, files } = await generate({
      name: positionals[0],
      dir: values.dir,
      namespace: values.namespace,
      entity: values.entity,
      db: /** @type {any} */ (values.db),
      target: /** @type {any} */ (values.target),
      tenancy: /** @type {any} */ (values.tenancy),
      policyDir: values.policy,
      sapdxSource: values['sapdx-source'],
      skipInstall: values['skip-install'],
      log: (m) => stdout(`> ${m}`),
    });
    stdout(`Created ${root} (${files.length} files).\nNext: cd ${positionals[0]} && npm run check`);
    return 0;
  } catch (err) {
    const e = /** @type {Error} */ (err);
    stderr(`create-cap-app: ${e.message}`);
    return e instanceof OptionsError || e instanceof TargetError ? 2 : 1;
  }
}
