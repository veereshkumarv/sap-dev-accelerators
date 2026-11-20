/**
 * What: Public entry point of @sapdx/readiness: evidence collection, the RDY-* checks, the
 *     Red/Amber/Green decision, report renderers and the CLI runner.
 * Why: Deployment pipelines and portals can embed the readiness decision programmatically through
 *     one stable import path.
 * If missing or unlinked: import "@sapdx/readiness" fails; only the sapdx-readiness command remains.
 */
export { collectEvidence, junit, lcovPercent } from './evidence.js';
export { CHECKS, checkTests, credentialPaths } from './checks.js';
export { assess, decide } from './readiness.js';
export { toJson, toMarkdown, toText } from './report.js';
export { EVIDENCE_TEMPLATE, runCli, USAGE } from './cli.js';
