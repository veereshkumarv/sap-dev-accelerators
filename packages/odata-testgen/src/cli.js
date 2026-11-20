/**
 * What: Command-line interface of odata-testgen: generate node:test files (CAP projects) or a
 *     Postman collection (any OData service) and print a summary of what was planned.
 * Why: Developers regenerate tests after model changes and CI checks that generated tests are up to
 *     date; exit codes 0 generated, 2 usage or input error.
 * If missing or unlinked: The odata-testgen command cannot start.
 */
import { parseArgs } from 'node:util';
import { generateTests } from './generate.js';

export const USAGE = `Usage: odata-testgen --input <cap-dir|edmx|snapshot> --emit node-test|postman [options]

Generates OData regression tests from service metadata: reads, query options,
create/update/delete, validation, draft, ETag, authorization (401/403) and
operation smoke tests.

Options:
  --input <path>       CAP project folder, $metadata EDMX file (V2/V4) or snapshot JSON
  --emit <format>      node-test (CAP, runs with cds.test) or postman (any deployed service)
  --out <path>         node-test: folder (default <project>/test/generated); postman: file
                       (default ./odata-tests.postman_collection.json)
  --roles <file>       roles.yaml with users and permissions (EDMX inputs; overrides CAP derivation)
  --service <name>     Only this service
  --base-path <path>   Service URL path for EDMX inputs, e.g. /sap/opu/odata4/sap/zui_x/srvd/sap/zui_x/0001
  --exclude <set>      Entity set to skip (repeatable)
  -h, --help

Exit codes: 0 generated, 2 usage or input error`;

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 * @returns {Promise<0 | 2>}
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        input: { type: 'string' },
        emit: { type: 'string' },
        out: { type: 'string' },
        roles: { type: 'string' },
        service: { type: 'string' },
        'base-path': { type: 'string' },
        exclude: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      stdout(USAGE);
      return 0;
    }
    if (!values.input || !values.emit) throw new Error('--input and --emit are required');
    const result = await generateTests({
      input: values.input,
      emit: /** @type {any} */ (values.emit),
      out: values.out,
      roles: values.roles,
      service: values.service,
      basePath: values['base-path'],
      exclude: values.exclude,
    });
    for (const plan of result.plans) {
      stdout(`${plan.service} (${plan.basePath}): ${plan.entities.length} entity set(s), ${plan.unbound.length} unbound operation(s)`);
      for (const e of plan.entities) {
        const who = [e.reader && `read: ${e.reader.name}`, e.writer && `write: ${e.writer.name}`, e.deniedReader && `denied read: ${e.deniedReader.name}`, e.deniedWriter && `denied write: ${e.deniedWriter.name}`]
          .filter(Boolean)
          .join(', ');
        stdout(`  ${e.set.name}${e.set.draft ? ' [draft]' : ''}${e.set.etag ? ' [etag]' : ''} - ${who || 'no users: authorization tests skipped'}`);
      }
    }
    if (!result.users.length) stdout('note: no users known - pass --roles roles.yaml to generate authenticated and 403 tests.');
    for (const f of result.removed) stdout(`removed stale generated file ${f}`);
    stdout(`Wrote ${result.files.length} file(s):\n  ${result.files.join('\n  ')}`);
    return 0;
  } catch (err) {
    stderr(`odata-testgen: ${/** @type {Error} */ (err).message}\n\n${USAGE}`);
    return 2;
  }
}
