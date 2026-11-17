/**
 * What: Model rules: CAP-AUTH-001/002 (authorization), CAP-NAME-001 (naming), CAP-TEST-001/002
 *     (tests), CAP-API-001 (ownership metadata).
 * Why: Secure-by-default and testable APIs are enforced from the compiled model, where they are
 *     reliably visible.
 * If missing or unlinked: Unprotected services/entities, untested operations and ownerless APIs
 *     pass the CAP gate.
 */
import YAML from 'yaml';
import { isValidCapName } from '@sapdx/policy';
import { isProjectDefinition, locationOf } from '../cds.js';

/**
 * @typedef {import('../lint.js').RuleContext} RuleContext
 */

/** Pseudo roles that identify a user but grant no business authorization. */
const PSEUDO_ROLES = new Set(['any', 'authenticated-user', 'system-user', 'internal-user']);
const TEST_FILE = /(^|\/)(test|tests|__tests__)\/.*\.(c|m)?js$|\.(test|spec)\.(c|m)?js$/;

/**
 * @param {any} csn
 * @returns {Array<[string, any]>} Project-owned definitions, sorted by name.
 */
function projectDefinitions(csn) {
  if (!csn) return [];
  return Object.entries(csn.definitions ?? {})
    .filter(([, def]) => isProjectDefinition(def))
    .sort(([a], [b]) => a.localeCompare(b));
}

/** @param {unknown} value */
function roles(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

/**
 * CAP-AUTH-001: every service declares @requires or @restrict; 'any' counts as missing.
 * CAP-AUTH-002: writable entities need a real role (entity @restrict/@requires or a
 * service @requires naming a business role), or must be @readonly.
 * @param {RuleContext} ctx
 */
export function checkAuthorization({ project, report }) {
  const defs = projectDefinitions(project.csn);
  const services = new Map(defs.filter(([, d]) => d.kind === 'service'));

  for (const [name, service] of services) {
    const requires = roles(service['@requires']);
    const hasRestrict = Array.isArray(service['@restrict']) && service['@restrict'].length > 0;
    if (requires.includes('any')) {
      report('CAP-AUTH-001', `Service ${name} uses @requires: 'any', which allows anonymous access.`, {
        object: name,
        location: locationOf(service),
      });
    } else if (requires.length === 0 && !hasRestrict) {
      report('CAP-AUTH-001', `Service ${name} declares neither @requires nor @restrict.`, {
        object: name,
        location: locationOf(service),
      });
    }
  }

  for (const [name, entity] of defs) {
    if (entity.kind !== 'entity') continue;
    const serviceName = [...services.keys()].find((s) => name.startsWith(`${s}.`));
    if (!serviceName) continue;
    if (entity['@readonly'] || entity['@cds.autoexposed'] || entity['@cds.persistence.skip'] === 'if-unused') continue;
    const service = services.get(serviceName);
    const entityRestrict = Array.isArray(entity['@restrict']) && entity['@restrict'].length > 0;
    const entityRoles = roles(entity['@requires']).filter((r) => !PSEUDO_ROLES.has(r));
    const serviceRoles = roles(service['@requires']).filter((r) => !PSEUDO_ROLES.has(r));
    const serviceRestrict = Array.isArray(service['@restrict']) && service['@restrict'].length > 0;
    if (!entityRestrict && entityRoles.length === 0 && serviceRoles.length === 0 && !serviceRestrict) {
      report(
        'CAP-AUTH-002',
        `Entity ${name} accepts writes but no business role protects it; add @restrict, a role in @requires, or @readonly.`,
        { object: name, location: locationOf(entity) },
      );
    }
  }
}

/**
 * CAP-NAME-001: namespace, service, entity and element names follow naming.yaml.
 * Elements are checked on persistence entities only (projections inherit them).
 * @param {RuleContext} ctx
 */
export function checkNaming({ project, policy, report }) {
  if (!policy.naming) return;
  const defs = projectDefinitions(project.csn);
  const serviceNames = defs.filter(([, d]) => d.kind === 'service').map(([n]) => n);
  /** @type {Set<string>} */
  const namespaces = new Set();

  for (const [name, def] of defs) {
    const inService = serviceNames.find((s) => name.startsWith(`${s}.`));
    const lastDot = name.lastIndexOf('.');
    const local = name.slice(lastDot + 1);
    const where = { object: name, location: locationOf(def) };
    if (def.kind === 'service') {
      if (!isValidCapName(policy.naming, 'service', local)) {
        report('CAP-NAME-001', `Service name ${local} does not match ${policy.naming.cap.servicePattern}.`, where);
      }
      continue;
    }
    if (def.kind !== 'entity') continue;
    if (!isValidCapName(policy.naming, 'entity', local)) {
      report('CAP-NAME-001', `Entity name ${local} does not match ${policy.naming.cap.entityPattern}.`, where);
    }
    if (inService) continue;
    if (lastDot > 0) namespaces.add(name.slice(0, lastDot));
    for (const element of Object.keys(def.elements ?? {}).sort()) {
      if (!isValidCapName(policy.naming, 'element', element)) {
        report('CAP-NAME-001', `Element ${local}.${element} does not match ${policy.naming.cap.elementPattern}.`, {
          object: `${name}.${element}`,
          location: locationOf(def.elements[element]) ?? locationOf(def),
        });
      }
    }
  }
  for (const ns of [...namespaces].sort()) {
    if (!isValidCapName(policy.naming, 'namespace', ns)) {
      report('CAP-NAME-001', `Namespace ${ns} does not match ${policy.naming.cap.namespacePattern}.`, { object: ns });
    }
  }
}

/**
 * CAP-TEST-001: each action/function is referenced by name in a test file.
 * CAP-TEST-002: some test asserts 401 or 403.
 * @param {RuleContext} ctx
 */
export async function checkTests({ project, report }) {
  const defs = projectDefinitions(project.csn);
  if (!defs.some(([, d]) => d.kind === 'service')) return;
  const testSources = await Promise.all(project.files.filter((f) => TEST_FILE.test(f)).map((f) => project.read(f)));
  const allTests = testSources.join('\n');

  /** @type {Array<{ name: string, object: string, def: any }>} */
  const operations = [];
  for (const [name, def] of defs) {
    if (def.kind === 'action' || def.kind === 'function') {
      operations.push({ name: name.slice(name.lastIndexOf('.') + 1), object: name, def });
    }
    if (def.kind === 'entity' && def.actions) {
      for (const [op, opDef] of Object.entries(def.actions)) operations.push({ name: op, object: `${name}.${op}`, def: opDef });
    }
  }
  for (const op of operations) {
    if (!new RegExp(`\\b${escapeRegExp(op.name)}\\b`).test(allTests)) {
      report('CAP-TEST-001', `Operation ${op.object} is not referenced by any test.`, {
        object: op.object,
        location: locationOf(op.def),
      });
    }
  }
  if (!/\b(401|403)\b/.test(allTests)) {
    report('CAP-TEST-002', 'No test asserts an unauthorized (401) or forbidden (403) response.', {
      object: project.pkg.name ?? 'project',
    });
  }
}

/**
 * CAP-API-001: catalog-info.yaml declares spec.owner, spec.lifecycle and the
 * metadata annotation "sapdx.io/api-version" (semantic version).
 * @param {RuleContext} ctx
 */
export async function checkApiMetadata({ project, report }) {
  const defs = projectDefinitions(project.csn);
  if (!defs.some(([, d]) => d.kind === 'service')) return;
  const file = 'catalog-info.yaml';
  const object = project.pkg.name ?? 'project';
  if (!project.files.includes(file)) {
    report('CAP-API-001', 'catalog-info.yaml is missing; declare owner, lifecycle and API version.', { object });
    return;
  }
  let doc;
  try {
    doc = YAML.parse(await project.read(file));
  } catch {
    report('CAP-API-001', 'catalog-info.yaml is not valid YAML.', { object, location: { file } });
    return;
  }
  /** @type {string[]} */
  const missing = [];
  if (!doc?.spec?.owner) missing.push('spec.owner');
  if (!doc?.spec?.lifecycle) missing.push('spec.lifecycle');
  if (!/^\d+\.\d+\.\d+/.test(String(doc?.metadata?.annotations?.['sapdx.io/api-version'] ?? ''))) {
    missing.push('metadata.annotations["sapdx.io/api-version"] (semver)');
  }
  if (missing.length) {
    report('CAP-API-001', `catalog-info.yaml lacks ${missing.join(', ')}.`, { object, location: { file } });
  }
}

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
