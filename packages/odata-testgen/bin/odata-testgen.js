#!/usr/bin/env node
/**
 * What: Executable for the odata-testgen command; delegates to the CLI module and sets the exit
 *     code.
 * Why: npm links this file as the odata-testgen command used in projects and CI.
 * If missing or unlinked: The odata-testgen command does not exist; tests cannot be regenerated.
 */
import { runCli } from '../src/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
