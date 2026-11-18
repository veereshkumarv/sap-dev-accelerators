/**
 * What: Loads and validates a RAP business-object model (YAML/JSON) and normalises it into
 *     entities, fields, keys, administrative fields and object names derived from
 *     policy/naming.yaml.
 * Why: Every generated artefact is derived from this one normalised model, so names, keys and
 *     types are consistent across tables, CDS views, behavior and service objects; all input
 *     problems are reported at once before anything is written.
 * If missing or unlinked: rap-scaffold cannot read models; generation stops before any object is
 *     produced.
 */
import YAML from 'yaml';
import { renderRapNames } from '@sapdx/policy';

export class ModelError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [problems]
   */
  constructor(message, problems = []) {
    super(problems.length ? `${message}\n  - ${problems.join('\n  - ')}` : message);
    this.name = 'ModelError';
    this.problems = problems;
  }
}

/**
 * @typedef {'char'|'numc'|'int4'|'dec'|'curr'|'cuky'|'dats'|'tims'} BuiltinType
 *
 * @typedef {object} Field
 * @property {string} column       Column name in the active table (upper case).
 * @property {string} element      CDS element name (PascalCase).
 * @property {string} label
 * @property {{ kind: 'builtin', type: BuiltinType, length?: number, decimals?: number } | { kind: 'dtel', name: string }} type
 * @property {boolean} key
 * @property {boolean} mandatory
 * @property {boolean} readonly
 * @property {string} [currency]   Element name of the currency field (curr fields).
 * @property {'createdBy'|'createdAt'|'localChangedBy'|'localChangedAt'|'lastChangedAt'} [admin]
 * @property {boolean} [parentKey]
 * @property {string} [sample]     ABAP literal used in generated unit tests.
 *
 * @typedef {object} Entity
 * @property {string} name         Technical entity name (upper case), e.g. ORDER.
 * @property {string} alias        Behavior alias (PascalCase), e.g. Order.
 * @property {string} label
 * @property {boolean} isRoot
 * @property {Record<string, string>} names  Object names from naming.yaml.
 * @property {Field[]} fields      Key first, then business fields, then administrative fields.
 * @property {string} assoc        Association name used by the other side (_Order, _Item).
 *
 * @typedef {object} Model
 * @property {string} area
 * @property {string} package
 * @property {string} description
 * @property {string} authorizationObject
 * @property {boolean} draft
 * @property {Entity} root
 * @property {Entity[]} children
 */

const BUILTINS = new Set(['char', 'numc', 'int4', 'dec', 'curr', 'cuky', 'dats', 'tims']);
const NAME = /^[A-Z][A-Z0-9_]*$/;
const ELEMENT = /^[A-Z][A-Za-z0-9]*$/;
const RESERVED = new Set(['CLIENT', 'MANDT', 'LOCAL_CREATED_BY', 'LOCAL_CREATED_AT', 'LOCAL_LAST_CHANGED_BY', 'LOCAL_LAST_CHANGED_AT', 'LAST_CHANGED_AT']);

/**
 * @param {string} text
 */
export function parseModelText(text) {
  try {
    return YAML.parse(text);
  } catch (err) {
    throw new ModelError(`Model is not valid YAML/JSON: ${/** @type {Error} */ (err).message}`);
  }
}

/** @param {string} upper e.g. SALES_ORDER -> SalesOrder */
export function pascal(upper) {
  return upper
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');
}

/**
 * @param {any} raw
 * @param {any} naming  policy naming section
 * @returns {Model}
 */
export function normalizeModel(raw, naming) {
  /** @type {string[]} */
  const problems = [];
  const need = (/** @type {boolean} */ ok, /** @type {string} */ msg) => {
    if (!ok) problems.push(msg);
    return ok;
  };
  if (!raw || typeof raw !== 'object') throw new ModelError('Model must be an object');

  need(typeof raw.area === 'string' && /^[A-Z][A-Z0-9]{1,3}$/.test(raw.area), 'area: 2-4 upper-case letters/digits (e.g. SD)');
  need(typeof raw.package === 'string' && new RegExp(naming.abap.packagePattern).test(raw.package), `package: must match ${naming.abap.packagePattern}`);
  need(typeof raw.description === 'string' && raw.description.length > 0 && raw.description.length <= 60, 'description: 1-60 characters');
  need(
    typeof raw.authorizationObject === 'string' && /^[ZY][A-Z0-9_]{1,9}$/.test(raw.authorizationObject),
    'authorizationObject: customer authorization object with field ACTVT (Z/Y, max 10 characters) - required for secure-by-default access control',
  );
  if (raw.draft !== undefined) need(typeof raw.draft === 'boolean', 'draft: true or false');
  need(raw.root && typeof raw.root === 'object', 'root: entity definition required');
  if (raw.children !== undefined) need(Array.isArray(raw.children), 'children: list of entity definitions');
  if (problems.length) throw new ModelError('Invalid RAP model', problems);

  const rootRaw = raw.root;
  const childRaws = raw.children ?? [];
  /** @type {Set<string>} */
  const entityNames = new Set();
  // Only unusable entity names abort early (nothing can be derived from them); every other
  // problem is collected so the author sees all of them in one run.
  let unusableNames = false;
  const entities = [rootRaw, ...childRaws].map((e, i) => {
    const where = i === 0 ? 'root' : `children[${i - 1}]`;
    if (!need(typeof e?.name === 'string' && NAME.test(e.name), `${where}.name: upper-case name (e.g. ORDER)`)) {
      unusableNames = true;
      return undefined;
    }
    need(!entityNames.has(e.name), `${where}.name: duplicate entity ${e.name}`);
    entityNames.add(e.name);
    if (e.alias !== undefined) need(typeof e.alias === 'string' && ELEMENT.test(e.alias), `${where}.alias: PascalCase`);
    need(Array.isArray(e.fields) && e.fields.length > 0, `${where}.fields: at least one field`);
    /** @type {Record<string, string>} */
    let names = {};
    try {
      names = renderRapNames(naming, { area: raw.area, entity: e.name });
    } catch (err) {
      unusableNames = true;
      problems.push(`${where}: ${/** @type {Error} */ (err).message.replace(/\n\s+- /g, '; ')}`);
    }
    return { raw: e, where, names };
  });
  if (unusableNames) throw new ModelError('Invalid RAP model', problems);

  const rootInfo = /** @type {{ raw: any, where: string, names: Record<string, string> }} */ (entities[0]);
  const rootAlias = rootInfo.raw.alias ?? pascal(rootInfo.raw.name);

  const normalized = entities.map((info, index) => {
    const { raw: e, where, names } = /** @type {{ raw: any, where: string, names: Record<string, string> }} */ (info);
    const isRoot = index === 0;
    const alias = e.alias ?? pascal(e.name);
    /** @type {Field[]} */
    const fields = [
      { column: `${e.name}_UUID`, element: `${alias}UUID`, label: `${e.label ?? alias} UUID`, type: { kind: 'dtel', name: 'SYSUUID_X16' }, key: true, mandatory: false, readonly: true },
    ];
    if (!isRoot) {
      fields.push({
        column: `${rootInfo.raw.name}_UUID`,
        element: `${rootAlias}UUID`,
        label: `${rootAlias} UUID`,
        type: { kind: 'dtel', name: 'SYSUUID_X16' },
        key: false,
        mandatory: false,
        readonly: true,
        parentKey: true,
      });
    }
    const seenColumns = new Set(fields.map((f) => f.column));
    const seenElements = new Set(fields.map((f) => f.element));

    (e.fields ?? []).forEach((/** @type {any} */ f, /** @type {number} */ i) => {
      const at = `${where}.fields[${i}]`;
      if (!need(typeof f?.name === 'string' && NAME.test(f.name) && f.name.length <= 30, `${at}.name: upper-case column name (max 30)`)) return;
      need(!RESERVED.has(f.name) && !seenColumns.has(f.name), `${at}.name: ${f.name} is reserved or duplicate`);
      const element = f.element ?? pascal(f.name);
      need(ELEMENT.test(element) && element.length <= 30, `${at}.element: PascalCase, max 30`);
      need(!seenElements.has(element), `${at}.element: duplicate element ${element}`);
      seenColumns.add(f.name);
      seenElements.add(element);

      /** @type {Field['type'] | undefined} */
      let type;
      if (f.dataElement !== undefined) {
        if (need(typeof f.dataElement === 'string' && /^[A-Z][A-Z0-9_/]{0,29}$/.test(f.dataElement), `${at}.dataElement: data element name`)) {
          type = { kind: 'dtel', name: f.dataElement };
        }
      } else if (need(BUILTINS.has(f.type), `${at}.type: one of ${[...BUILTINS].join(', ')} (or use dataElement)`)) {
        const t = /** @type {BuiltinType} */ (f.type);
        if (['char', 'numc'].includes(t)) need(Number.isInteger(f.length) && f.length >= 1 && f.length <= 255, `${at}.length: 1-255`);
        if (['dec', 'curr'].includes(t)) {
          need(Number.isInteger(f.length) && f.length >= 1 && f.length <= 31, `${at}.length: 1-31`);
          need(Number.isInteger(f.decimals ?? 0) && (f.decimals ?? 0) >= 0 && (f.decimals ?? 0) <= 14, `${at}.decimals: 0-14`);
        }
        type = { kind: 'builtin', type: t, ...(f.length ? { length: f.length } : {}), ...(['dec', 'curr'].includes(t) ? { decimals: f.decimals ?? 0 } : {}) };
      }
      const mandatory = Boolean(f.mandatory);
      if (mandatory && type?.kind === 'dtel') {
        need(typeof f.sample === 'string' && f.sample.length > 0, `${at}.sample: ABAP literal required for mandatory data-element fields (used in unit tests)`);
      }
      fields.push({
        column: f.name,
        element,
        label: typeof f.label === 'string' ? f.label : element,
        type: /** @type {Field['type']} */ (type),
        key: false,
        mandatory,
        readonly: Boolean(f.readonly),
        ...(f.currency !== undefined ? { currency: String(f.currency) } : {}),
        ...(f.sample !== undefined ? { sample: String(f.sample) } : {}),
      });
    });

    // currency references must point to a cuky field of the same entity
    for (const f of fields) {
      if (f.type?.kind === 'builtin' && f.type.type === 'curr') {
        const ref = fields.find((x) => x.column === f.currency || x.element === f.currency);
        if (need(Boolean(ref) && ref?.type?.kind === 'builtin' && ref.type.type === 'cuky', `${where}: ${f.column}.currency must name a cuky field of the same entity`)) {
          f.currency = /** @type {Field} */ (ref).element;
        }
      }
    }

    const admin = isRoot
      ? /** @type {const} */ ([
          ['LOCAL_CREATED_BY', 'LocalCreatedBy', 'ABP_CREATION_USER', 'createdBy'],
          ['LOCAL_CREATED_AT', 'LocalCreatedAt', 'ABP_CREATION_TSTMPL', 'createdAt'],
          ['LOCAL_LAST_CHANGED_BY', 'LocalLastChangedBy', 'ABP_LOCINST_LASTCHANGE_USER', 'localChangedBy'],
          ['LOCAL_LAST_CHANGED_AT', 'LocalLastChangedAt', 'ABP_LOCINST_LASTCHANGE_TSTMPL', 'localChangedAt'],
          ['LAST_CHANGED_AT', 'LastChangedAt', 'ABP_LASTCHANGE_TSTMPL', 'lastChangedAt'],
        ])
      : /** @type {const} */ ([['LOCAL_LAST_CHANGED_AT', 'LocalLastChangedAt', 'ABP_LOCINST_LASTCHANGE_TSTMPL', 'localChangedAt']]);
    for (const [column, element, dtel, kind] of admin) {
      need(!seenElements.has(element), `${where}: element ${element} is reserved for administrative fields`);
      fields.push({ column, element, label: element, type: { kind: 'dtel', name: dtel }, key: false, mandatory: false, readonly: true, admin: kind });
    }

    return /** @type {Entity} */ ({ name: e.name, alias, label: e.label ?? alias, isRoot, names, fields, assoc: `_${alias}` });
  });

  const aliases = normalized.map((e) => e.alias);
  if (new Set(aliases).size !== aliases.length) problems.push(`entity aliases must be unique: ${aliases.join(', ')}`);
  if (problems.length) throw new ModelError('Invalid RAP model', problems);

  return {
    area: raw.area,
    package: raw.package,
    description: raw.description,
    authorizationObject: raw.authorizationObject,
    draft: raw.draft ?? true,
    root: normalized[0],
    children: normalized.slice(1),
  };
}
