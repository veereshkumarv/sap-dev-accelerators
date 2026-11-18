/**
 * What: Builds DDIC table field definitions (DD03P) for the active and draft tables of each
 *     entity: client field, UUID keys, business fields (built-in types or data elements),
 *     currency references, administrative fields and the draft administration include.
 * Why: Table metadata must match the CDS views and the RAP draft rules exactly (draft tables use
 *     upper-case CDS element names and the SYCH_BDL_DRAFT_ADMIN_INC include).
 * If missing or unlinked: No table definitions are generated; the CDS views and behavior
 *     definition reference non-existing tables and activation fails.
 */

/** @typedef {import('./model.js').Field} Field */
/** @typedef {import('./model.js').Entity} Entity */
/** @typedef {import('./abapgit.js').Node} Node */

/** @param {number} n */
const pad6 = (n) => String(n).padStart(6, '0');

/**
 * Internal DDIC representation of built-in types.
 * @param {import('./model.js').BuiltinType} type
 * @param {number} [length]
 * @param {number} [decimals]
 * @returns {{ inttype: string, intlen: number, leng: number, decimals?: number }}
 */
export function builtinSpec(type, length = 0, decimals = 0) {
  switch (type) {
    case 'char':
      return { inttype: 'C', intlen: length * 2, leng: length };
    case 'numc':
      return { inttype: 'N', intlen: length * 2, leng: length };
    case 'int4':
      return { inttype: 'X', intlen: 4, leng: 10 };
    case 'dec':
    case 'curr':
      return { inttype: 'P', intlen: Math.floor(length / 2) + 1, leng: length, decimals };
    case 'cuky':
      return { inttype: 'C', intlen: 10, leng: 5 };
    case 'dats':
      return { inttype: 'D', intlen: 16, leng: 8 };
    case 'tims':
      return { inttype: 'T', intlen: 12, leng: 6 };
    default:
      throw new TypeError(`Unsupported built-in type ${String(type)}`);
  }
}

/**
 * @param {Field} field
 * @param {string} fieldName    column name in this table
 * @param {string} tableName
 * @param {(element: string) => string} columnOf  maps an element to this table's column name
 * @returns {Node[]}
 */
function fieldNode(field, fieldName, tableName, columnOf) {
  /** @type {Node[]} */
  const node = [['FIELDNAME', fieldName]];
  if (field.key) node.push(['KEYFLAG', 'X']);
  if (field.type.kind === 'dtel') {
    node.push(['ROLLNAME', field.type.name], ['ADMINFIELD', '0']);
    if (field.key) node.push(['NOTNULL', 'X']);
    node.push(['COMPTYPE', 'E']);
    return node;
  }
  const t = field.type;
  const spec = builtinSpec(t.type, t.length, t.decimals);
  node.push(['ADMINFIELD', '0'], ['INTTYPE', spec.inttype], ['INTLEN', pad6(spec.intlen)]);
  if (t.type === 'curr' && field.currency) node.push(['REFTABLE', tableName], ['REFFIELD', columnOf(field.currency)]);
  if (field.key) node.push(['NOTNULL', 'X']);
  node.push(['DATATYPE', t.type.toUpperCase()], ['LENG', pad6(spec.leng)]);
  if (spec.decimals !== undefined) node.push(['DECIMALS', pad6(spec.decimals)]);
  node.push(['MASK', `  ${t.type.toUpperCase()}`]);
  return node;
}

/**
 * @param {Entity} entity
 * @returns {Node[][]}
 */
export function activeTableFields(entity) {
  const table = entity.names.table;
  const columnOf = (/** @type {string} */ element) => /** @type {Field} */ (entity.fields.find((f) => f.element === element)).column;
  return [
    [
      ['FIELDNAME', 'CLIENT'],
      ['KEYFLAG', 'X'],
      ['ADMINFIELD', '0'],
      ['INTTYPE', 'C'],
      ['INTLEN', '000006'],
      ['NOTNULL', 'X'],
      ['DATATYPE', 'CLNT'],
      ['LENG', '000003'],
      ['MASK', '  CLNT'],
    ],
    ...entity.fields.map((f) => fieldNode(f, f.column, table, columnOf)),
  ];
}

/**
 * Draft table: same fields named after the upper-case CDS elements, plus the draft include.
 * @param {Entity} entity
 * @returns {Node[][]}
 */
export function draftTableFields(entity) {
  const table = entity.names.draftTable;
  const columnOf = (/** @type {string} */ element) => element.toUpperCase();
  return [
    [
      ['FIELDNAME', 'MANDT'],
      ['KEYFLAG', 'X'],
      ['ROLLNAME', 'MANDT'],
      ['ADMINFIELD', '0'],
      ['NOTNULL', 'X'],
      ['COMPTYPE', 'E'],
    ],
    ...entity.fields.map((f) => fieldNode(f, f.element.toUpperCase(), table, columnOf)),
    [
      ['FIELDNAME', '.INCLUDE'],
      ['ADMINFIELD', '0'],
      ['PRECFIELD', 'SYCH_BDL_DRAFT_ADMIN_INC'],
      ['MASK', '      S'],
      ['DDTEXT', 'Standard Include for Draft Administration (BDL Syntax Check)'],
      ['COMPTYPE', 'S'],
      ['GROUPNAME', '%ADMIN'],
    ],
  ];
}
