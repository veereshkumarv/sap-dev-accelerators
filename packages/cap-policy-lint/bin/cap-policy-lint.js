#!/usr/bin/env node
/**
 * What: Executable for the cap-policy-lint command; delegates to the CLI module and sets the
 *     process exit code.
 * Why: npm links this file as the command used by generated projects and CI.
 * If missing or unlinked: The cap-policy-lint command is missing; npm run policy in generated
 *     projects fails.
 */
import { runCli } from '../src/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
