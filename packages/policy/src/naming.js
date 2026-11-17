/**
 * Naming helpers shared by generators (to produce names) and linters (to check them).
 */

const ABAP_MAX_LENGTH = { table: 16, draftTable: 16 };
const ABAP_DEFAULT_MAX = 30;

export class NamingError extends Error {
  /**
   * @param {string} message
   * @param {string[]} problems
   */
  constructor(message, problems) {
    super(`${message}\n  - ${problems.join('\n  - ')}`);
    this.name = 'NamingError';
    this.problems = problems;
  }
}

/**
 * Renders all RAP object names for one entity from naming.yaml templates and
 * validates ABAP length and character limits.
 * @param {any} naming  Parsed naming.yaml.
 * @param {{ area: string, entity: string }} input
 * @returns {Record<string, string>}
 */
export function renderRapNames(naming, { area, entity }) {
  /** @type {string[]} */
  const problems = [];
  if (!/^[A-Z][A-Z0-9]{1,3}$/.test(area)) problems.push(`area "${area}" must be 2-4 uppercase letters/digits`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(entity)) problems.push(`entity "${entity}" must be uppercase letters, digits and _`);
  if (problems.length) throw new NamingError('Invalid RAP naming input', problems);

  /** @type {Record<string, string>} */
  const names = {};
  for (const [kind, template] of Object.entries(/** @type {Record<string, string>} */ (naming.abap.rap))) {
    const name = template.replaceAll('{AREA}', area).replaceAll('{ENTITY}', entity);
    const max = /** @type {Record<string, number>} */ (ABAP_MAX_LENGTH)[kind] ?? ABAP_DEFAULT_MAX;
    if (name.length > max) problems.push(`${kind} name ${name} is ${name.length} characters (max ${max})`);
    if (!name.startsWith(naming.abap.prefix)) problems.push(`${kind} name ${name} lacks customer prefix ${naming.abap.prefix}`);
    names[kind] = name;
  }
  if (problems.length) throw new NamingError(`RAP names for ${area}/${entity} violate limits; shorten the entity name`, problems);
  return names;
}

/**
 * @param {any} naming  Parsed naming.yaml.
 * @param {'namespace' | 'service' | 'entity' | 'element'} kind
 * @param {string} name
 */
export function isValidCapName(naming, kind, name) {
  const pattern = naming.cap[`${kind}Pattern`];
  if (typeof pattern !== 'string') throw new TypeError(`No CAP naming pattern for ${kind}`);
  return new RegExp(pattern).test(name);
}
