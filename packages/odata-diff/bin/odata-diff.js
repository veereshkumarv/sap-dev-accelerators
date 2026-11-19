#!/usr/bin/env node
/**
 * What: Executable for the odata-diff command; delegates to the CLI module and sets the exit code.
 * Why: npm links this file as the odata-diff command used in API projects and CI.
 * If missing or unlinked: The odata-diff command does not exist; API compatibility is not checked in CI.
 */
import { runCli } from '../src/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
