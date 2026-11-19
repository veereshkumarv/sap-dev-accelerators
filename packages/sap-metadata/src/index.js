/**
 * What: Public entry point of @sapdx/sap-metadata: service-model loading (EDMX, CAP project,
 *     snapshot), normalisation and helpers.
 * Why: odata-diff and odata-testgen share one metadata model through one stable import path.
 * If missing or unlinked: Both OData tools fail to import their metadata reader.
 */
/**
 * @typedef {import('./model.js').ServiceModel} ServiceModel
 * @typedef {import('./model.js').Service} Service
 * @typedef {import('./model.js').EntitySet} EntitySet
 * @typedef {import('./model.js').Property} Property
 * @typedef {import('./model.js').Operation} Operation
 */
export { fromEdmx, mergeModels, parseSnapshot, MetadataError } from './model.js';
export { loadServiceModel, fromCapProject, loadCsn } from './load.js';
