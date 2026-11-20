/**
 * What: Derives who may read, write and call what: from a CAP model (@requires / @restrict on
 *     services, entities and operations plus the project's mocked users) or from a roles.yaml file
 *     for EDMX inputs; picks an allowed and a denied user per operation.
 * Why: Generated authorization tests (401/403 and allowed access) must reflect the real
 *     authorization model, not a guess - otherwise they either fail or prove nothing.
 * If missing or unlinked: odata-testgen cannot generate authorization tests and falls back to no
 *     user context at all.
 */
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

/**
 * A requirement a user must satisfy: public (no login), any authenticated user, or one of roles.
 * @typedef {{ public?: boolean, anyUser?: boolean, roles?: string[] }} Check
 * @typedef {{ name: string, password: string, roles: string[] }} User
 *
 * @typedef {object} Access
 * @property {User[]} users
 * @property {(service: string, entitySet: string) => { read: Check[], write: Check[], autoexposed: boolean }} entity
 * @property {(service: string, op: { name: string, entitySet?: string }) => Check[]} operation
 */

const WRITE_EVENTS = ['CREATE', 'UPDATE', 'DELETE', 'WRITE', 'UPSERT', '*'];

export class AccessError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AccessError';
  }
}

/**
 * @param {unknown} value  @requires / @restrict "to" value
 * @returns {Check}
 */
export function toCheck(value) {
  const list = (Array.isArray(value) ? value : [value]).filter((v) => v !== undefined && v !== null).map(String);
  if (!list.length || list.includes('any')) return { public: true };
  if (list.includes('authenticated-user')) return { anyUser: true };
  return { roles: list };
}

/**
 * @param {User | undefined} user  undefined = anonymous
 * @param {Check[]} checks
 */
export function allowed(user, checks) {
  return checks.every((c) => c.public || (user && (c.anyUser || (c.roles ?? []).some((r) => user.roles.includes(r)))));
}

/**
 * First user satisfying / not satisfying the checks (anonymous excluded).
 * @param {User[]} users
 * @param {Check[]} checks
 */
export function pickUsers(users, checks) {
  return { allowed: users.find((u) => allowed(u, checks)), denied: users.find((u) => !allowed(u, checks)) };
}

/**
 * Access model from a compiled CAP CSN and the resolved mocked users.
 * @param {any} csn
 * @param {Record<string, any>} usersConfig  cds.env requires.auth.users
 * @returns {Access}
 */
export function accessFromCap(csn, usersConfig) {
  const users = Object.entries(usersConfig ?? {})
    .filter(([name, u]) => name !== '*' && u && typeof u === 'object')
    .map(([name, u]) => ({ name, password: typeof u.password === 'string' ? u.password : '', roles: Array.isArray(u.roles) ? u.roles.map(String) : [] }));
  const defs = csn.definitions;
  const serviceCheck = (/** @type {string} */ service) => toCheck(defs[service]?.['@requires']);

  /** @param {any} restrict @param {(grant: string[]) => boolean} matches */
  const grantCheck = (restrict, matches) => {
    /** @type {string[]} */
    const roles = [];
    let open = false;
    let anyUser = false;
    for (const g of Array.isArray(restrict) ? restrict : []) {
      const grants = (Array.isArray(g.grant) ? g.grant : [g.grant ?? '*']).map((/** @type {unknown} */ x) => String(x).toUpperCase());
      if (!matches(grants)) continue;
      const c = toCheck(g.to);
      if (c.public) open = true;
      else if (c.anyUser) anyUser = true;
      else roles.push(...(c.roles ?? []));
    }
    return open ? { public: true } : anyUser ? { anyUser: true } : { roles };
  };

  return {
    users,
    entity(service, entitySet) {
      const def = defs[`${service}.${entitySet}`] ?? {};
      const read = [serviceCheck(service)];
      const write = [serviceCheck(service)];
      if (def['@requires'] !== undefined) {
        read.push(toCheck(def['@requires']));
        write.push(toCheck(def['@requires']));
      }
      if (Array.isArray(def['@restrict'])) {
        read.push(grantCheck(def['@restrict'], (g) => g.includes('READ') || g.includes('*')));
        write.push(grantCheck(def['@restrict'], (g) => g.some((x) => WRITE_EVENTS.includes(x))));
      }
      return { read, write, autoexposed: Boolean(def['@cds.autoexposed']) };
    },
    operation(service, op) {
      const checks = [serviceCheck(service)];
      const entity = op.entitySet ? defs[`${service}.${op.entitySet}`] : undefined;
      const opDef = entity ? entity.actions?.[op.name] : defs[`${service}.${op.name}`];
      if (entity?.['@requires'] !== undefined) checks.push(toCheck(entity['@requires']));
      if (Array.isArray(entity?.['@restrict'])) {
        checks.push(grantCheck(entity['@restrict'], (g) => g.includes('*') || g.includes(op.name.toUpperCase())));
      }
      if (opDef?.['@requires'] !== undefined) checks.push(toCheck(opDef['@requires']));
      return checks;
    },
  };
}

/**
 * Access model from roles.yaml:
 *   users:       { admin: { roles: [Admin], password: "" } }
 *   requires:    authenticated-user | any | [Role]          (service level, default authenticated-user)
 *   permissions: { SalesOrders: { read: [Viewer], write: [Admin] }, "SalesOrders/cancel": [Admin] }
 * @param {string} file
 * @returns {Promise<Access>}
 */
export async function accessFromRolesFile(file) {
  let doc;
  try {
    doc = YAML.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new AccessError(`Cannot read roles file ${file}: ${/** @type {Error} */ (err).message}`);
  }
  if (!doc || typeof doc.users !== 'object' || doc.users === null) throw new AccessError(`${file}: "users" map is required`);
  /** @type {User[]} */
  const users = Object.entries(doc.users).map(([name, u]) => ({
    name,
    password: typeof u?.password === 'string' ? u.password : '',
    roles: Array.isArray(u?.roles) ? u.roles.map(String) : [],
  }));
  const service = toCheck(doc.requires ?? 'authenticated-user');
  const permissions = doc.permissions ?? {};
  return {
    users,
    entity(_service, entitySet) {
      const p = permissions[entitySet] ?? {};
      return {
        read: [service, ...(p.read ? [toCheck(p.read)] : [])],
        write: [service, ...(p.write ? [toCheck(p.write)] : [])],
        autoexposed: false,
      };
    },
    operation(_service, op) {
      const key = op.entitySet ? `${op.entitySet}/${op.name}` : op.name;
      return [service, ...(permissions[key] ? [toCheck(permissions[key])] : [])];
    },
  };
}
