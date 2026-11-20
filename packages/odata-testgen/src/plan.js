/**
 * What: Plans the regression tests for each entity set and operation of a service model: reads,
 *     query options, create (including draft activation), validation (missing mandatory fields,
 *     invalid types), update, delete, ETag concurrency, authorization (401/403) and operation smoke
 *     tests - independent of the output format.
 * Why: One plan feeds both emitters (node:test for CAP, Postman/Newman for deployed services), so
 *     both cover the same cases; cases are only planned when capabilities and users allow them.
 * If missing or unlinked: No tests can be generated.
 */
import { allowed, pickUsers } from './access.js';

/**
 * @typedef {import('@sapdx/sap-metadata').ServiceModel} ServiceModel
 * @typedef {import('@sapdx/sap-metadata').EntitySet} EntitySet
 * @typedef {import('@sapdx/sap-metadata').Property} Property
 * @typedef {import('@sapdx/sap-metadata').Operation} Operation
 * @typedef {import('./access.js').Access} Access
 * @typedef {import('./access.js').User} User
 *
 * @typedef {object} EntityPlan
 * @property {string} service
 * @property {string} basePath
 * @property {EntitySet} set
 * @property {User | undefined} reader
 * @property {User | undefined} writer
 * @property {User | undefined} deniedReader     authenticated but not allowed to read
 * @property {User | undefined} deniedWriter     allowed to read, not allowed to write
 * @property {boolean} anonymousDenied
 * @property {Record<string, unknown>} payload     create payload (writable properties)
 * @property {string[]} mandatory                  mandatory properties included in payload
 * @property {Property | undefined} stringProperty for $filter/$orderby and PATCH
 * @property {Property | undefined} typedProperty  non-string property for the invalid-type test
 * @property {Array<OperationPlan>} boundOperations
 *
 * @typedef {object} OperationPlan
 * @property {Operation} op
 * @property {User | undefined} allowedUser
 * @property {User | undefined} deniedUser
 * @property {boolean} anonymousDenied
 * @property {Record<string, unknown>} params
 *
 * @typedef {{ service: string, basePath: string, entities: EntityPlan[], unbound: OperationPlan[] }} ServicePlan
 */

/**
 * Sample value per EDM type; undefined = cannot be generated (property skipped).
 * Strings are kept short and within maxLength.
 * @param {Property | { type: string, maxLength?: number, scale?: number | string }} p
 * @param {number} seq
 */
export function sampleValue(p, seq) {
  switch (p.type) {
    case 'Edm.String': {
      const value = `T${seq}`;
      return value.slice(0, Math.max(1, p.maxLength ?? value.length));
    }
    case 'Edm.Int16':
    case 'Edm.Int32':
    case 'Edm.Int64':
    case 'Edm.Byte':
    case 'Edm.SByte':
      return 1;
    case 'Edm.Decimal':
    case 'Edm.Double':
    case 'Edm.Single':
      return 1;
    case 'Edm.Boolean':
      return true;
    case 'Edm.Date':
      return '2026-01-01';
    case 'Edm.DateTimeOffset':
      return '2026-01-01T00:00:00Z';
    case 'Edm.TimeOfDay':
      return '12:00:00';
    case 'Edm.Guid':
      return '00000000-0000-4000-8000-000000000001';
    default:
      return undefined;
  }
}

/**
 * @param {ServiceModel} model
 * @param {{ access?: Access, paths: Record<string, string>, include?: (set: EntitySet) => boolean }} options
 *   paths: service name -> base URL path (e.g. /odata/v4/sales-orders)
 * @returns {ServicePlan[]}
 */
export function planTests(model, { access, paths, include = () => true }) {
  return model.services.map((service) => {
    const basePath = paths[service.name] ?? `/${service.name}`;
    const users = access?.users ?? [];
    const entities = service.entitySets
      .filter((set) => include(set) && !(access?.entity(service.name, set.name).autoexposed))
      .map((set) => {
        const rules = access?.entity(service.name, set.name) ?? { read: [{ anyUser: true }], write: [{ anyUser: true }], autoexposed: false };
        const readers = pickUsers(users, rules.read);
        const writers = pickUsers(users, rules.write);
        let seq = 0;
        /** @type {Record<string, unknown>} */
        const payload = {};
        for (const p of set.properties) {
          if (p.computed || p.foreignKey || (p.key && p.type === 'Edm.Guid' && p.computed)) continue;
          const value = sampleValue(p, ++seq);
          if (value !== undefined) payload[p.name] = value;
        }
        const keysCovered = set.keys.every((k) => set.properties.find((p) => p.name === k)?.computed || k in payload);
        const writable = (/** @type {Property} */ p) => !p.key && !p.computed && !p.foreignKey && !p.immutable;
        return /** @type {EntityPlan} */ ({
          service: service.name,
          basePath,
          set: keysCovered ? set : { ...set, capabilities: { ...set.capabilities, insertable: false } },
          reader: readers.allowed,
          writer: writers.allowed,
          deniedReader: readers.denied,
          deniedWriter: users.find((u) => allowed(u, rules.read) && !allowed(u, rules.write)),
          anonymousDenied: !allowed(undefined, rules.read),
          payload,
          mandatory: set.properties.filter((p) => p.mandatory && p.name in payload).map((p) => p.name),
          stringProperty: set.properties.find((p) => writable(p) && p.type === 'Edm.String'),
          typedProperty: set.properties.find((p) => writable(p) && ['Edm.Int16', 'Edm.Int32', 'Edm.Int64', 'Edm.Decimal', 'Edm.Date', 'Edm.Boolean'].includes(p.type)),
          boundOperations: service.operations.filter((op) => op.entitySet === set.name).map((op) => planOperation(service.name, op, access, users)),
        });
      });
    return {
      service: service.name,
      basePath,
      entities,
      unbound: service.operations.filter((op) => !op.bound).map((op) => planOperation(service.name, op, access, users)),
    };
  });
}

/**
 * @param {string} service
 * @param {Operation} op
 * @param {Access | undefined} access
 * @param {User[]} users
 * @returns {OperationPlan}
 */
function planOperation(service, op, access, users) {
  const checks = access?.operation(service, op) ?? [{ anyUser: true }];
  const picked = pickUsers(users, checks);
  /** @type {Record<string, unknown>} */
  const params = {};
  op.parameters.forEach((p, i) => {
    const value = sampleValue(p, i + 1);
    if (value !== undefined) params[p.name] = value;
  });
  return { op, allowedUser: picked.allowed, deniedUser: picked.denied, anonymousDenied: !allowed(undefined, checks), params };
}

/**
 * OData key predicate for a created entity, e.g. (ID=<guid>) or (ID=<guid>,IsActiveEntity=true).
 * Used by the emitters at runtime via a generated helper; exported for tests.
 * @param {EntitySet} set
 * @param {Record<string, unknown>} entity
 * @param {boolean | undefined} [active]
 */
export function keyPredicate(set, entity, active) {
  const parts = set.keys.map((k) => {
    const type = set.properties.find((p) => p.name === k)?.type;
    const v = entity[k];
    const literal = type === 'Edm.String' ? `'${String(v).replace(/'/g, "''")}'` : String(v);
    return set.keys.length === 1 && active === undefined ? literal : `${k}=${literal}`;
  });
  if (active !== undefined) parts.push(`IsActiveEntity=${active}`);
  return `(${parts.join(',')})`;
}
