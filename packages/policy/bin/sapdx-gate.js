#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runGate } from '../src/gate.js';

const USAGE = `Usage: sapdx-gate <file.sarif...> [options]

Merges SARIF from all quality tools, applies the central policy (severities,
exemptions) and fails on new non-exempted Blocker/Critical findings.

Options:
  --policy <dir>           Policy directory (default: nearest ./policy or bundled)
  --baseline <file>        Baseline of accepted legacy findings
  --write-baseline <file>  Create a baseline from current findings (no gating)
  --out <file>             Write merged policy-applied SARIF
  --today <YYYY-MM-DD>     Override current date
  -h, --help

Exit codes: 0 passed, 1 gate failed, 2 usage or configuration error`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      policy: { type: 'string' },
      baseline: { type: 'string' },
      'write-baseline': { type: 'string' },
      out: { type: 'string' },
      today: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!positionals.length) throw new Error('At least one SARIF file is required');
  const { exitCode, report } = await runGate({
    sarifFiles: positionals,
    policyDir: values.policy,
    baselineFile: values.baseline,
    writeBaseline: values['write-baseline'],
    out: values.out,
    today: values.today,
  });
  console.log(report);
  process.exitCode = exitCode;
} catch (err) {
  console.error(`sapdx-gate: ${/** @type {Error} */ (err).message}\n\n${USAGE}`);
  process.exitCode = 2;
}
