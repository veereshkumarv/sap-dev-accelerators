/**
 * What: Public entry point of @sapdx/policy: re-exports loader, policy application, naming
 *     helpers, gate runner and types.
 * Why: Gives tools one stable import path for all governance functions.
 * If missing or unlinked: import "@sapdx/policy" fails in every tool and the Policy type is
 *     unresolved.
 */
/**
 * @typedef {import('./load.js').Policy} Policy
 * @typedef {import('./load.js').Rule} Rule
 * @typedef {import('./load.js').Exemption} Exemption
 */

export { loadPolicy, resolvePolicyDir, PolicyError, BUNDLED_POLICY_DIR } from './load.js';
export { applyPolicy, isoToday } from './apply.js';
export { renderRapNames, isValidCapName, NamingError } from './naming.js';
export { runGate } from './gate.js';
