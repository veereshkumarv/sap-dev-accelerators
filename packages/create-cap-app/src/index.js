/**
 * What: Public entry point of @sapdx/create-cap-app: generate() API, CLI runner, naming and
 *     catalog helpers.
 * Why: The self-service portal and tests call the generator programmatically through one stable
 *     import path.
 * If missing or unlinked: Programmatic use of the generator fails; only the bin script remains.
 */
export { generate, GenerationError, TargetError } from './generate.js';
export { runCli, USAGE } from './cli.js';
export { deriveNames, OptionsError, DEFAULTS } from './options.js';
export { fileCatalog } from './catalog.js';
export { render, RenderError } from './render.js';
export { withHeader, commentStyle, renderFilesDoc } from './headers.js';
