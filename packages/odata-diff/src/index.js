/**
 * What: Public entry point of @sapdx/odata-diff: model comparison, policy-aware reporting and the
 *     CLI runner.
 * Why: The readiness checker and CI scripts call the API compatibility check programmatically.
 * If missing or unlinked: Programmatic use of odata-diff fails; only the CLI remains.
 */
export { diffServiceModels, recommendBump } from './diff.js';
export { compareApis, toJsonReport, toText, TOOL } from './report.js';
export { runCli, USAGE } from './cli.js';
