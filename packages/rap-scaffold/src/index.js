/**
 * What: Public entry point of @sapdx/rap-scaffold: scaffold/write API, model helpers, abaplint
 *     verification and the CLI runner.
 * Why: The self-service portal and the BO scaffolder (Tool 6) call the RAP generator
 *     programmatically through one stable import path.
 * If missing or unlinked: Programmatic use of the generator fails; only the bin script remains.
 */
export { scaffold, writeFiles, OverwriteError } from './scaffold.js';
export { normalizeModel, parseModelText, pascal, ModelError } from './model.js';
export { verifyFiles, GRAMMAR_GAPS, KNOWN_GAPS } from './verify.js';
export { runCli, USAGE } from './cli.js';
