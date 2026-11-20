/**
 * What: Command-line interface of sapdx-readiness: "check" assesses an evidence folder for a target
 *     (DEV / QA / PROD) and prints or writes the decision; "init" writes an evidence.yaml template.
 * Why: Pipelines call one command before each deployment and act on its exit code: 0 Green, 1 Red,
 *     3 Amber (configurable with --amber-exit), 2 usage or configuration error.
 * If missing or unlinked: The sapdx-readiness command cannot start; no readiness decision is made.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { assess } from './readiness.js';
import { toJson, toMarkdown, toText } from './report.js';

export const USAGE = `Usage:
  sapdx-readiness check --evidence <dir> --target <DEV|QA|PROD> [options]
  sapdx-readiness init [--out <file>]       write an evidence.yaml template (default ./evidence/evidence.yaml)

Evidence folder conventions (any sub-folder):
  *.sarif                      quality findings (cap-policy-lint, abap-policy-lint, sapdx-gate ...)
  gitleaks*.sarif|json         secret scan            npm-audit.json / *audit*.json  dependency audit
  *.xml (JUnit)                test results; files/paths containing "contract", "api-tests" or
                               "newman" count as API contract tests
  lcov.info / coverage-summary.json   line coverage   api-diff.json   odata-diff --format json
  evidence.yaml                release manifest: version, previousVersion, changeRecord, rollback,
                               project, dbMigration, transports

Options:
  --format text|json|markdown  Output format (default: text)
  --out <file>                 Write the report to a file (a one-line summary is still printed)
  --policy <dir>               Policy directory (default: nearest ./policy or bundled)
  --baseline <file>            Baseline for existing findings (sapdx-gate --write-baseline)
  --today <YYYY-MM-DD>         Override current date (exemption expiry)
  --amber-exit <n>             Exit code for AMBER (default: 3; use 0 to let Amber deploy)

Exit codes: 0 GREEN, 1 RED, 3 AMBER, 2 usage or configuration error`;

export const EVIDENCE_TEMPLATE = `# What: Release manifest read by sapdx-readiness: release version, change record, rollback
#     procedure, project location, database migration and transport information.
# Why: Evidence that no tool produces (change records, rollback plans, transport sequence) must
#     still be stated explicitly so the release decision can check it.
# If missing or unlinked: Checks that depend on it (RDY-CHANGE-RECORD, RDY-ROLLBACK,
#     RDY-DESCRIPTOR, RDY-PROD-CONFIG, RDY-API-COMPAT version rule, RDY-TRANSPORT) report "missing".

version: 1.1.0              # version being released
previousVersion: 1.0.0      # version in production (proves a major bump for breaking API changes)
changeRecord: CHG0012345    # must match thresholds.changeRecordPattern in policy/readiness.yaml
rollback: rollback.md       # rollback / roll-forward procedure, relative to this folder
project: ..                 # project root (mta.yaml or .abapgit.xml, package.json), relative to this folder

dbMigration:
  destructive: false        # true when columns/tables are dropped or narrowed
  # plan: migration-plan.md # required when destructive

# transports:               # ABAP deliveries only
#   targetSystem: Q01
#   requests:
#     - id: S4DK900123
#       predecessors:
#         - { id: S4DK900100, importedIn: [Q01] }
`;

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, cwd?: string }} [io]
 * @returns {Promise<number>}
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  const cwd = io.cwd ?? process.cwd();
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        evidence: { type: 'string' },
        target: { type: 'string' },
        format: { type: 'string', default: 'text' },
        out: { type: 'string' },
        policy: { type: 'string' },
        baseline: { type: 'string' },
        today: { type: 'string' },
        'amber-exit': { type: 'string', default: '3' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      stdout(USAGE);
      return 0;
    }
    const [command, ...rest] = positionals;
    if (rest.length) throw new Error(`Unexpected argument: ${rest[0]}`);

    if (command === 'init') {
      const file = path.resolve(cwd, values.out ?? 'evidence/evidence.yaml');
      if (await exists(file)) throw new Error(`${file} already exists`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, EVIDENCE_TEMPLATE);
      stdout(`Evidence manifest template written to ${file}. Fill in version, changeRecord, rollback and project.`);
      return 0;
    }

    if (command !== 'check') throw new Error(command ? `Unknown command: ${command}` : 'Missing command (check or init)');
    if (!values.evidence) throw new Error('--evidence <dir> is required');
    if (!values.target) throw new Error('--target <DEV|QA|PROD> is required');
    if (!['text', 'json', 'markdown'].includes(values.format)) throw new Error(`Unknown format: ${values.format}`);
    if (values.today && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) throw new Error('--today must be YYYY-MM-DD');
    const amberExit = Number(values['amber-exit']);
    if (!Number.isInteger(amberExit) || amberExit < 0 || amberExit > 255) throw new Error('--amber-exit must be an integer 0-255');

    const assessment = await assess({
      evidenceDir: path.resolve(cwd, values.evidence),
      target: values.target,
      cwd,
      ...(values.policy ? { policyDir: values.policy } : {}),
      ...(values.baseline ? { baselineFile: path.resolve(cwd, values.baseline) } : {}),
      ...(values.today ? { today: values.today } : {}),
    });
    const output =
      values.format === 'json' ? JSON.stringify(toJson(assessment), null, 2) : values.format === 'markdown' ? toMarkdown(assessment) : toText(assessment);
    if (values.out) {
      const file = path.resolve(cwd, values.out);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${output}\n`);
      const failed = assessment.checks.filter((c) => c.status === 'fail' || c.status === 'missing').length;
      stdout(`DECISION: ${assessment.decision} for ${assessment.target} (${failed} failed or missing check(s)). Report written to ${values.out}.`);
    } else {
      stdout(output);
    }
    return assessment.decision === 'GREEN' ? 0 : assessment.decision === 'RED' ? 1 : amberExit;
  } catch (err) {
    stderr(`sapdx-readiness: ${/** @type {Error} */ (err).message}\n\n${USAGE}`);
    return 2;
  }
}

/** @param {string} file */
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
