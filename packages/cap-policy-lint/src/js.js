/**
 * What: JavaScript AST helpers: parse (ESM/CommonJS) with espree, walk nodes, read names,
 *     literals and line numbers.
 * Why: Code rules inspect handler code structurally (no regex guessing) and never execute project
 *     code.
 * If missing or unlinked: Server-code and secret rules cannot parse JavaScript and the linter
 *     fails to load.
 */
import * as espree from 'espree';

/**
 * Parses JavaScript source to an ESTree AST. Tries ES module first, then script
 * (CommonJS). Returns undefined for unparsable files (e.g. TypeScript).
 * @param {string} source
 * @returns {any | undefined}
 */
export function parseJs(source) {
  const base = { ecmaVersion: /** @type {const} */ ('latest'), loc: true, range: true };
  for (const sourceType of /** @type {const} */ (['module', 'commonjs'])) {
    try {
      return espree.parse(stripHashbang(source), { ...base, sourceType });
    } catch {
      // try next source type
    }
  }
  return undefined;
}

/** @param {string} source */
function stripHashbang(source) {
  return source.startsWith('#!') ? `//${source.slice(2)}` : source;
}

/**
 * Depth-first walk calling visit(node, parent) for every ESTree node.
 * @param {any} ast
 * @param {(node: any, parent: any) => void} visit
 */
export function walk(ast, visit) {
  /** @type {Array<[any, any]>} */
  const stack = [[ast, null]];
  while (stack.length) {
    const [node, parent] = /** @type {[any, any]} */ (stack.pop());
    visit(node, parent);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range' || key === 'parent') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          if (isNode(value[i])) stack.push([value[i], node]);
        }
      } else if (isNode(value)) {
        stack.push([value, node]);
      }
    }
  }
}

/** @param {unknown} v */
function isNode(v) {
  return typeof v === 'object' && v !== null && typeof (/** @type {any} */ (v).type) === 'string';
}

/**
 * Name of a property key or member property (identifier or string literal).
 * @param {any} node
 * @returns {string | undefined}
 */
export function keyName(node) {
  if (!node) return undefined;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return undefined;
}

/**
 * Property name of a member expression (a.b / a['b']), else identifier name.
 * @param {any} node
 */
export function referencedName(node) {
  if (!node) return undefined;
  if (node.type === 'MemberExpression') return node.computed ? keyName(node.property) : node.property?.name;
  if (node.type === 'Identifier') return node.name;
  return undefined;
}

/**
 * @param {any} node
 * @returns {boolean}
 */
export function isStaticLiteral(node) {
  return (
    (node?.type === 'Literal' && (typeof node.value === 'string' || typeof node.value === 'number')) ||
    (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
  );
}

/** @param {any} node */
export function lineOf(node) {
  return node?.loc?.start?.line;
}
