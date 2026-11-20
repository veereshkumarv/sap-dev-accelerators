/**
 * What: Public entry point of @sapdx/s4-mock: start() plus the fault and event helpers.
 * Why: Other projects start the mock from their own tests (before/after hooks) through one stable
 *     import path.
 * If missing or unlinked: require('@sapdx/s4-mock') fails; the mock is only usable via its CLI.
 */
const { start, ROOT } = require('./src/start');
const { buildEvent, deliver, emitEvent } = require('./src/events');
const { FAULTS, parseRules, pickFault, errorBody, faultMiddleware } = require('./src/faults');

module.exports = { start, ROOT, buildEvent, deliver, emitEvent, FAULTS, parseRules, pickFault, errorBody, faultMiddleware };
