#!/usr/bin/env node
/**
 * What: Executable for the abap-policy-lint command; delegates to the CLI module and sets the exit
 *     code.
 * Why: npm links this file as the command used in ABAP repositories and CI pipelines.
 * If missing or unlinked: The abap-policy-lint command does not exist; ABAP pipelines cannot run
 *     the clean-core gate.
 */
import { runCli } from '../src/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
