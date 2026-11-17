import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';

/**
 * @typedef {import('@sapdx/findings').Severity} Severity
 *
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} title
 * @property {Severity} severity
 * @property {string} tool
 * @property {string} [description]
 * @property {string} [helpUri]
 * @property {boolean} [enabled]
 * @property {boolean} [baselineable]
 *
 * @typedef {object} Exemption
 * @property {string} id
 * @property {string} rule
 * @property {string} [object]
 * @property {string} [path]
 * @property {string} owner
 * @property {string} approver
 * @property {string} justification
 * @property {string} created
 * @property {string} expires
 * @property {string} backlog
 *
 * @typedef {object} Policy
 * @property {string} dir
 * @property {Rule[]} rules
 * @property {Exemption[]} exemptions
 * @property {any} [naming]
 * @property {any} [forbiddenObjects]
 * @property {any} [readiness]
 * @property {(ruleId: string) => Rule | undefined} ruleFor
 */

const addFormats = /** @type {any} */ (addFormatsModule).default ?? addFormatsModule;
const SCHEMA_DIR = fileURLToPath(new URL('../schemas/', import.meta.url));
/** Repository default policy (used when no --policy dir and none found upwards). */
export const BUNDLED_POLICY_DIR = fileURLToPath(new URL('../../../policy/', import.meta.url));
const MAX_EXEMPTION_DAYS = 366;

export class PolicyError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [details]
   */
  constructor(message, details = []) {
    super(details.length ? `${message}\n  - ${details.join('\n  - ')}` : message);
    this.name = 'PolicyError';
    this.details = details;
  }
}

/**
 * Policy directory resolution: explicit argument, SAPDX_POLICY_DIR, nearest
 * "policy/rules.yaml" walking up from cwd, then the bundled default.
 * @param {string} [explicit]
 * @param {string} [cwd]
 */
export async function resolvePolicyDir(explicit, cwd = process.cwd()) {
  if (explicit) return path.resolve(cwd, explicit);
  if (process.env.SAPDX_POLICY_DIR) return path.resolve(cwd, process.env.SAPDX_POLICY_DIR);
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, 'policy');
    if (await exists(path.join(candidate, 'rules.yaml'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return BUNDLED_POLICY_DIR;
    dir = parent;
  }
}

/**
 * Loads and validates a policy directory. Throws PolicyError listing every
 * problem found so that policy authors can fix them in one pass.
 * @param {string} dir
 * @returns {Promise<Policy>}
 */
export async function loadPolicy(dir) {
  // strictRequired is off because anyOf branches legitimately name properties defined on the parent.
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);

  const rulesDoc = await readPolicyFile(ajv, dir, 'rules', true);
  const exemptionsDoc = await readPolicyFile(ajv, dir, 'exemptions', false);
  const naming = await readPolicyFile(ajv, dir, 'naming', false);
  const forbiddenObjects = await readPolicyFile(ajv, dir, 'forbidden-objects', false);
  const readiness = await readPolicyFile(ajv, dir, 'readiness', false);

  /** @type {Rule[]} */
  const rules = rulesDoc.rules;
  /** @type {Exemption[]} */
  const exemptions = exemptionsDoc?.exemptions ?? [];
  const ruleFor = createRuleLookup(rules);

  /** @type {string[]} */
  const problems = [];
  duplicates(rules.map((r) => r.id)).forEach((id) => problems.push(`rules.yaml: duplicate rule id ${id}`));
  duplicates(exemptions.map((e) => e.id)).forEach((id) => problems.push(`exemptions.yaml: duplicate exemption id ${id}`));
  for (const e of exemptions) {
    if (!ruleFor(e.rule)) problems.push(`exemptions.yaml: ${e.id} references unknown rule ${e.rule}`);
    if (e.owner.toLowerCase() === e.approver.toLowerCase()) problems.push(`exemptions.yaml: ${e.id} approver must differ from owner`);
    if (e.expires < e.created) problems.push(`exemptions.yaml: ${e.id} expires before it was created`);
    if (daysBetween(e.created, e.expires) > MAX_EXEMPTION_DAYS) {
      problems.push(`exemptions.yaml: ${e.id} exceeds the 12-month maximum duration`);
    }
    if (ruleFor(e.rule)?.baselineable === false && ruleFor(e.rule)?.id.startsWith('POL-')) {
      problems.push(`exemptions.yaml: ${e.id} policy rules cannot be exempted`);
    }
  }
  if (problems.length) throw new PolicyError(`Invalid policy in ${dir}`, problems);

  return { dir, rules, exemptions, naming, forbiddenObjects, readiness, ruleFor };
}

/**
 * Exact id first, then the longest matching wildcard family ("ABAP-LINT-*").
 * @param {Rule[]} rules
 */
function createRuleLookup(rules) {
  const exact = new Map(rules.filter((r) => !r.id.endsWith('*')).map((r) => [r.id, r]));
  const wildcards = rules.filter((r) => r.id.endsWith('*')).sort((a, b) => b.id.length - a.id.length);
  /** @param {string} ruleId */
  return (ruleId) => exact.get(ruleId) ?? wildcards.find((r) => ruleId.startsWith(r.id.slice(0, -1)));
}

/**
 * @param {Ajv} ajv
 * @param {string} dir
 * @param {string} name
 * @param {boolean} required
 */
async function readPolicyFile(ajv, dir, name, required) {
  const file = path.join(dir, `${name}.yaml`);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT' && !required) return undefined;
    throw new PolicyError(`Cannot read policy file ${file}: ${/** @type {Error} */ (err).message}`);
  }
  let doc;
  try {
    doc = YAML.parse(text, { prettyErrors: true });
  } catch (err) {
    throw new PolicyError(`Invalid YAML in ${file}`, [/** @type {Error} */ (err).message]);
  }
  const schemaFile = path.join(SCHEMA_DIR, `${name}.schema.json`);
  if (await exists(schemaFile)) {
    const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
    const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
    if (!validate(doc)) {
      throw new PolicyError(
        `Schema validation failed for ${file}`,
        (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`),
      );
    }
  }
  return doc;
}

/** @param {string[]} values */
function duplicates(values) {
  const seen = new Set();
  const dups = new Set();
  for (const v of values) (seen.has(v) ? dups : seen).add(v);
  return [...dups];
}

/**
 * @param {string} from
 * @param {string} to
 */
function daysBetween(from, to) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/** @param {string} file */
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
