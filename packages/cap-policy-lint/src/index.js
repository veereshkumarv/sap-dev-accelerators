/**
 * What: Public entry point of @sapdx/cap-policy-lint: lintProject API, project loader and CLI
 *     runner.
 * Why: Lets other tools (e.g. readiness checks, tests) lint CAP projects programmatically.
 * If missing or unlinked: Programmatic imports of the linter fail; only the CLI file itself would
 *     remain usable.
 */
export { lintProject, CHECKS, TOOL } from './lint.js';
export { loadProject, LintError } from './project.js';
export { runCli } from './cli.js';
