/**
 * What: Public entry point of @sapdx/odata-testgen: test generation, planning, access derivation,
 *     emitters and the CLI runner.
 * Why: CI scripts and other accelerators (e.g. the self-service portal) generate tests
 *     programmatically through one stable import path.
 * If missing or unlinked: Programmatic use of the test generator fails; only the CLI remains.
 */
export { generateTests, GenerateError, GENERATED_MARKER } from './generate.js';
export { planTests, sampleValue, keyPredicate } from './plan.js';
export { accessFromCap, accessFromRolesFile, allowed, pickUsers, toCheck, AccessError } from './access.js';
export { emitNodeTests } from './emit-node.js';
export { emitPostman } from './emit-postman.js';
export { runCli, USAGE } from './cli.js';
