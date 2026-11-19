/**
 * What: Compares two OData service models and classifies every difference as breaking (ODATA-BRK-*)
 *     or additive (ODATA-CHG-001): removed/renamed sets, properties, navigations and operations,
 *     narrowed types, new mandatory fields, changed keys, removed write capabilities, draft and ETag
 *     changes.
 * Why: Incompatible API changes must be caught in the pull request, before shared QA and before
 *     consumers break; the rules follow OData client expectations, not just structural equality.
 * If missing or unlinked: odata-diff has no comparison logic; API compatibility is not checked.
 */

/**
 * @typedef {import('@sapdx/sap-metadata').ServiceModel} ServiceModel
 * @typedef {import('@sapdx/sap-metadata').EntitySet} EntitySet
 * @typedef {import('@sapdx/sap-metadata').Property} Property
 * @typedef {import('@sapdx/sap-metadata').Operation} Operation
 * @typedef {{ ruleId: string, object: string, message: string }} Change
 */

/** @param {string} a @param {string} b */
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @template T
 * @param {T[]} before
 * @param {T[]} after
 * @param {(item: T) => string} keyOf
 */
function pair(before, after, keyOf) {
  const a = new Map(before.map((x) => [keyOf(x), x]));
  const b = new Map(after.map((x) => [keyOf(x), x]));
  return {
    removed: [...a.keys()].filter((k) => !b.has(k)).sort(byName).map((k) => /** @type {T} */ (a.get(k))),
    added: [...b.keys()].filter((k) => !a.has(k)).sort(byName).map((k) => /** @type {T} */ (b.get(k))),
    both: [...a.keys()].filter((k) => b.has(k)).sort(byName).map((k) => /** @type {[T, T]} */ ([a.get(k), b.get(k)])),
  };
}

/**
 * @param {ServiceModel} before
 * @param {ServiceModel} after
 * @returns {Change[]}
 */
export function diffServiceModels(before, after) {
  /** @type {Change[]} */
  const changes = [];
  const add = (/** @type {string} */ ruleId, /** @type {string} */ object, /** @type {string} */ message) => changes.push({ ruleId, object, message });

  const services = pair(before.services, after.services, (s) => s.name);
  for (const s of services.removed) add('ODATA-BRK-001', s.name, `Service ${s.name} was removed.`);
  for (const s of services.added) add('ODATA-CHG-001', s.name, `Service ${s.name} was added.`);

  for (const [oldS, newS] of services.both) {
    const sets = pair(oldS.entitySets, newS.entitySets, (e) => e.name);
    for (const e of sets.removed) add('ODATA-BRK-001', `${oldS.name}/${e.name}`, `Entity set ${e.name} was removed.`);
    for (const e of sets.added) add('ODATA-CHG-001', `${newS.name}/${e.name}`, `Entity set ${e.name} was added.`);
    for (const [o, n] of sets.both) diffEntitySet(`${oldS.name}/${o.name}`, o, n, add);

    const ops = pair(oldS.operations, newS.operations, (op) => `${op.entitySet ?? ''}/${op.name}`);
    const opPath = (/** @type {Operation} */ op) => `${oldS.name}/${op.entitySet ? `${op.entitySet}/` : ''}${op.name}()`;
    for (const op of ops.removed) add('ODATA-BRK-005', opPath(op), `${cap(op.kind)} ${op.name} was removed.`);
    for (const op of ops.added) add('ODATA-CHG-001', opPath(op), `${cap(op.kind)} ${op.name} was added.`);
    for (const [o, n] of ops.both) diffOperation(opPath(o), o, n, add);
  }
  return changes;
}

/**
 * @param {string} at
 * @param {EntitySet} o
 * @param {EntitySet} n
 * @param {(ruleId: string, object: string, message: string) => void} add
 */
function diffEntitySet(at, o, n, add) {
  if (o.keys.join(',') !== n.keys.join(',')) add('ODATA-BRK-006', at, `Key changed from (${o.keys.join(', ')}) to (${n.keys.join(', ')}).`);

  for (const capability of /** @type {const} */ (['readable', 'insertable', 'updatable', 'deletable'])) {
    if (o.capabilities[capability] && !n.capabilities[capability]) add(capability === 'readable' ? 'ODATA-BRK-001' : 'ODATA-BRK-007', at, `Entity set is no longer ${capability}.`);
    if (!o.capabilities[capability] && n.capabilities[capability]) add('ODATA-CHG-001', at, `Entity set became ${capability}.`);
  }
  if (o.draft !== n.draft) add('ODATA-BRK-005', at, `Draft handling was ${n.draft ? 'enabled' : 'disabled'}; create and edit follow a different protocol.`);
  if (!o.etag && n.etag) add('ODATA-BRK-007', at, 'ETag concurrency control was introduced; updates now require If-Match.');
  if (o.etag && !n.etag) add('ODATA-CHG-001', at, 'ETag concurrency control was removed.');

  const props = pair(o.properties, n.properties, (p) => p.name);
  for (const p of props.removed) add('ODATA-BRK-002', `${at}/${p.name}`, `Property ${p.name} was removed.`);
  for (const p of props.added) {
    if (p.mandatory && n.capabilities.insertable) add('ODATA-BRK-004', `${at}/${p.name}`, `New mandatory property ${p.name}; existing create requests do not send it.`);
    else add('ODATA-CHG-001', `${at}/${p.name}`, `Optional property ${p.name} was added.`);
  }
  for (const [a, b] of props.both) diffProperty(`${at}/${a.name}`, a, b, n, add);

  const navs = pair(o.navigations, n.navigations, (x) => x.name);
  for (const x of navs.removed) add('ODATA-BRK-002', `${at}/${x.name}`, `Navigation ${x.name} was removed.`);
  for (const x of navs.added) add('ODATA-CHG-001', `${at}/${x.name}`, `Navigation ${x.name} was added.`);
  for (const [a, b] of navs.both) {
    if (a.target !== b.target || a.isCollection !== b.isCollection) {
      add('ODATA-BRK-003', `${at}/${a.name}`, `Navigation ${a.name} changed from ${a.target}${a.isCollection ? '[*]' : ''} to ${b.target}${b.isCollection ? '[*]' : ''}.`);
    }
  }
}

/**
 * @param {string} at
 * @param {Property} a
 * @param {Property} b
 * @param {EntitySet} set
 * @param {(ruleId: string, object: string, message: string) => void} add
 */
function diffProperty(at, a, b, set, add) {
  if (a.type !== b.type) {
    add('ODATA-BRK-003', at, `Type changed from ${a.type} to ${b.type}.`);
    return;
  }
  const narrowed = [];
  if (b.maxLength !== undefined && (a.maxLength === undefined || b.maxLength < a.maxLength)) narrowed.push(`maxLength ${a.maxLength ?? 'unlimited'} -> ${b.maxLength}`);
  if (b.precision !== undefined && a.precision !== undefined && b.precision < a.precision) narrowed.push(`precision ${a.precision} -> ${b.precision}`);
  if (typeof a.scale === 'number' && typeof b.scale === 'number' && b.scale < a.scale) narrowed.push(`scale ${a.scale} -> ${b.scale}`);
  if (narrowed.length) add('ODATA-BRK-003', at, `Value range narrowed (${narrowed.join(', ')}).`);
  else if (a.maxLength !== undefined && (b.maxLength === undefined || b.maxLength > a.maxLength)) add('ODATA-CHG-001', at, `maxLength widened from ${a.maxLength} to ${b.maxLength ?? 'unlimited'}.`);

  if (!a.mandatory && b.mandatory && set.capabilities.insertable) add('ODATA-BRK-004', at, `Property ${a.name} became mandatory.`);
  if (a.nullable && !b.nullable && !b.computed && !b.key && !(!a.mandatory && b.mandatory)) add('ODATA-BRK-004', at, `Property ${a.name} no longer accepts null.`);
  if (!a.computed && b.computed && (set.capabilities.insertable || set.capabilities.updatable)) add('ODATA-BRK-007', at, `Property ${a.name} became read-only (computed).`);
  if (!a.immutable && b.immutable && set.capabilities.updatable) add('ODATA-BRK-007', at, `Property ${a.name} can no longer be updated (immutable).`);
}

/**
 * @param {string} at
 * @param {Operation} o
 * @param {Operation} n
 * @param {(ruleId: string, object: string, message: string) => void} add
 */
function diffOperation(at, o, n, add) {
  if (o.kind !== n.kind) add('ODATA-BRK-005', at, `${cap(o.kind)} ${o.name} became a ${n.kind}; HTTP method and URL change.`);
  if ((o.returnType ?? '') !== (n.returnType ?? '')) add('ODATA-BRK-005', at, `Return type changed from ${o.returnType ?? 'none'} to ${n.returnType ?? 'none'}.`);
  const params = pair(o.parameters, n.parameters, (p) => p.name);
  for (const p of params.removed) add('ODATA-BRK-005', at, `Parameter ${p.name} was removed.`);
  for (const p of params.added) add(p.nullable ? 'ODATA-CHG-001' : 'ODATA-BRK-005', at, `${p.nullable ? 'Optional' : 'Mandatory'} parameter ${p.name} was added.`);
  for (const [a, b] of params.both) {
    if (a.type !== b.type) add('ODATA-BRK-005', at, `Parameter ${a.name} changed type from ${a.type} to ${b.type}.`);
    else if (a.nullable && !b.nullable) add('ODATA-BRK-005', at, `Parameter ${a.name} became mandatory.`);
  }
}

/** @param {string} s */
function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Semantic-versioning recommendation for the API version (catalog-info.yaml).
 * @param {Change[]} changes
 * @returns {'major' | 'minor' | 'patch'}
 */
export function recommendBump(changes) {
  if (changes.some((c) => c.ruleId.startsWith('ODATA-BRK-'))) return 'major';
  if (changes.length) return 'minor';
  return 'patch';
}
