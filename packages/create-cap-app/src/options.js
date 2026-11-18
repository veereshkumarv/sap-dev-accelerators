/**
 * What: Validates generator options and derives every name used in the generated project
 *     (service, entity, file and role names, npm package name, deployment facets).
 * Why: All naming decisions live in one place and are checked against policy/naming.yaml before
 *     anything is written, so generated projects pass CAP-NAME-001 by construction.
 * If missing or unlinked: create-cap-app cannot validate input or compute names and stops; with a
 *     broken naming link, generated projects would fail the policy gate on first push.
 */
import { isValidCapName } from '@sapdx/policy';

export class OptionsError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'OptionsError';
  }
}

export const DEFAULTS = Object.freeze({
  namespace: 'acme.sales',
  entity: 'SalesOrders',
  tenancy: 'single',
  target: 'cf',
  db: 'hana',
  sapdxSource: 'registry',
});

/**
 * @typedef {object} GenerateOptions
 * @property {string} name           Project folder and npm package base name (kebab-case).
 * @property {string} [dir]          Parent directory (default: cwd).
 * @property {string} [namespace]    CDS namespace (must match naming policy).
 * @property {string} [entity]       Root entity name, plural PascalCase (e.g. SalesOrders).
 * @property {'single'|'multi'} [tenancy]
 * @property {'cf'|'kyma'} [target]
 * @property {'hana'|'postgres'} [db]
 * @property {string} [sapdxSource]  "registry" or path to the sap-dev-accelerators monorepo.
 *
 * @typedef {ReturnType<typeof deriveNames>} Names
 */

/**
 * @param {GenerateOptions} input
 * @param {any} naming  policy naming section
 */
export function deriveNames(input, naming) {
  const opts = { ...DEFAULTS, ...stripUndefined(input), name: String(input.name ?? '') };
  /** @type {string[]} */
  const problems = [];
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(opts.name ?? '')) problems.push(`name "${opts.name}" must be kebab-case (e.g. sales-orders)`);
  if (!['single', 'multi'].includes(opts.tenancy)) problems.push(`tenancy must be single or multi`);
  if (!['cf', 'kyma'].includes(opts.target)) problems.push(`target must be cf or kyma`);
  if (!['hana', 'postgres'].includes(opts.db)) problems.push(`db must be hana or postgres`);
  if (opts.target === 'kyma') {
    problems.push('target kyma is not supported yet: "cds add kyma" could not be verified in this toolchain; use cf');
  }
  if (opts.tenancy === 'multi') {
    problems.push('tenancy multi is not supported yet: the generated MTX sidecar is not covered by the generated tests');
  }
  if (!/^[A-Z][A-Za-z0-9]*s$/.test(opts.entity)) problems.push(`entity "${opts.entity}" must be plural PascalCase ending in "s" (e.g. SalesOrders)`);
  if (!isValidCapName(naming, 'namespace', opts.namespace)) {
    problems.push(`namespace "${opts.namespace}" does not match naming policy ${naming.cap.namespacePattern}`);
  }
  if (problems.length) throw new OptionsError(`Invalid options:\n  - ${problems.join('\n  - ')}`);

  const pascal = opts.name.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  const service = `${pascal.replace(/Service$/, '')}Service`;
  const entity = opts.entity;
  const itemEntity = `${entity.slice(0, -1)}Items`;
  for (const [kind, value] of /** @type {const} */ ([['service', service], ['entity', entity], ['entity', itemEntity]])) {
    if (!isValidCapName(naming, kind, value)) throw new OptionsError(`Derived ${kind} name ${value} violates naming policy`);
  }
  const serviceFile = `${opts.name.replace(/-service$/, '')}-service`;

  return {
    ...opts,
    projectName: opts.name,
    npmName: `${naming.cap.npmScope}/${opts.name}`,
    service,
    servicePath: opts.name.replace(/-service$/, ''),
    serviceFile,
    entity,
    itemEntity,
    entityLabel: splitWords(entity),
    logger: opts.name,
    facets: ['nodejs', opts.db, 'xsuaa', 'mta', 'destination', 'application-logging', 'lint', 'sqlite'],
  };
}

/** @param {string} pascal */
function splitWords(pascal) {
  return pascal.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * @template {object} T
 * @param {T} obj
 * @returns {Partial<T>}
 */
function stripUndefined(obj) {
  return /** @type {Partial<T>} */ (Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)));
}
