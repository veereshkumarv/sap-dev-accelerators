#!/usr/bin/env node
/**
 * What: Executable for the sapdx-readiness command; delegates to the CLI module and sets the exit code.
 * Why: npm links this file as the sapdx-readiness command that pipelines run before each deployment.
 * If missing or unlinked: The sapdx-readiness command does not exist; deployments have no readiness gate.
 */
import { runCli } from '../src/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
