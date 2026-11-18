#!/usr/bin/env node
/**
 * What: Executable for the create-cap-app command; delegates to the CLI module and sets the exit
 *     code.
 * Why: npm links this file as the create-cap-app command (also usable via npx).
 * If missing or unlinked: The create-cap-app command does not exist.
 */
import { runCli } from '../src/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
