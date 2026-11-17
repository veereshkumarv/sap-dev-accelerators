/**
 * What: Server-code rules: CAP-CFG-001 (URL literals), CAP-CFG-002 (org values), CAP-PERF-001
 *     (unbounded SELECT), CAP-LOG-001 (console).
 * Why: Hard-coded configuration and full-table reads are common causes of failed transports and
 *     production incidents.
 * If missing or unlinked: Hard-coded endpoints, company codes and unbounded queries pass the CAP
 *     gate.
 */
import { isStaticLiteral, keyName, lineOf, referencedName, walk } from '../js.js';

/**
 * @typedef {import('../lint.js').RuleContext} RuleContext
 */

/** Server code folders. UI code under app/ is linted by UI5 tooling, not here. */
const SERVER_DIRS = ['srv/'];
const ORG_FIELD = /^(companycode|company_code|bukrs|salesorganization|salesorg|vkorg|plant|werks|distributionchannel|vtweg|division|spart)$/i;
const URL_LITERAL = /^https?:\/\//i;
const ALLOWED_URL = /^https?:\/\/(localhost|127\.0\.0\.1|www\.w3\.org\/|schemas\.|docs\.oasis-open\.org\/)/i;
const BOUNDING_CALLS = new Set(['where', 'limit', 'one', 'byKey']);

/**
 * Runs all AST-based server-code rules in one pass per file:
 * CAP-CFG-001 (URL literals), CAP-CFG-002 (org values), CAP-PERF-001 (unbounded
 * SELECT), CAP-LOG-001 (console).
 * @param {RuleContext} ctx
 */
export async function checkServerCode({ project, report }) {
  for (const dir of SERVER_DIRS) {
    for (const { file, ast } of await project.jsFiles(dir)) {
      /** @type {Map<any, any>} */
      const parents = new Map();
      walk(ast, (node, parent) => parents.set(node, parent));
      const at = (/** @type {any} */ node, /** @type {string} */ object) => ({
        object,
        location: { file, ...(lineOf(node) ? { line: lineOf(node) } : {}) },
      });

      for (const node of parents.keys()) {
        // CAP-CFG-001
        const text = literalText(node);
        if (text !== undefined && URL_LITERAL.test(text) && !ALLOWED_URL.test(text)) {
          report('CAP-CFG-001', `Hard-coded URL ${shorten(text)}; read endpoints from a destination or cds.requires.`, at(node, `${file}#${shorten(text)}`));
        }

        // CAP-CFG-002
        const org = orgValue(node);
        if (org) {
          report('CAP-CFG-002', `Hard-coded ${org.field} value '${org.value}'; take organisational values from configuration.`, at(node, `${file}#${org.field}=${org.value}`));
        }

        // CAP-PERF-001
        if (isSelectFrom(node) && !isBounded(node, parents)) {
          report('CAP-PERF-001', 'SELECT.from without where/limit/one/byKey reads the whole table.', at(node, `${file}#SELECT.from`));
        }
        if (node.type === 'TaggedTemplateExpression' && referencedName(node.tag) === 'SELECT') {
          const sql = node.quasi.quasis.map((/** @type {any} */ q) => q.value.cooked).join(' ');
          if (!/\b(where|limit|one)\b/i.test(sql)) {
            report('CAP-PERF-001', 'SELECT template without where/limit reads the whole table.', at(node, `${file}#SELECT\``));
          }
        }

        // CAP-LOG-001
        if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'console') {
          report('CAP-LOG-001', `console.${referencedName(node.callee)} used; use cds.log() for structured logging.`, at(node, `${file}#console`));
        }
      }
    }
  }
}

/** @param {any} node */
function literalText(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.quasis.length) return node.quasis[0].value.cooked ?? undefined;
  return undefined;
}

/**
 * Org value in comparisons (x.CompanyCode === '1010'), assignments
 * (x.SalesOrganization = '1710') and object properties ({ Plant: '1010' }).
 * @param {any} node
 * @returns {{ field: string, value: string } | undefined}
 */
function orgValue(node) {
  /** @type {[any, any] | undefined} */
  let pair;
  if (node.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(node.operator)) {
    pair = isStaticLiteral(node.right) ? [node.left, node.right] : [node.right, node.left];
  } else if (node.type === 'AssignmentExpression' && node.operator === '=') {
    pair = [node.left, node.right];
  } else if (node.type === 'Property' && !node.computed) {
    pair = [node.key, node.value];
  }
  if (!pair) return undefined;
  const field = keyName(pair[0]) ?? referencedName(pair[0]);
  if (field && ORG_FIELD.test(field) && isStaticLiteral(pair[1])) return { field, value: String(literalValue(pair[1])) };
  return undefined;
}

/** @param {any} node */
function literalValue(node) {
  return node.type === 'Literal' ? node.value : node.quasis[0].value.cooked;
}

/**
 * SELECT.from(...) or cds.ql.SELECT.from(...).
 * @param {any} node
 */
function isSelectFrom(node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  if (referencedName(node.callee) !== 'from') return false;
  return referencedName(node.callee.object) === 'SELECT';
}

/**
 * Bounded when a key is passed (SELECT.from(X, key)) or the call chain contains
 * where/limit/one/byKey.
 * @param {any} call
 * @param {Map<any, any>} parents
 */
function isBounded(call, parents) {
  if (call.arguments.length > 1) return true;
  let node = call;
  for (;;) {
    const parent = parents.get(node);
    if (parent?.type === 'MemberExpression' && parent.object === node) {
      if (BOUNDING_CALLS.has(referencedName(parent) ?? '')) return true;
      node = parent;
      continue;
    }
    if (parent?.type === 'CallExpression' && parent.callee === node) {
      node = parent;
      continue;
    }
    return false;
  }
}

/** @param {string} text */
function shorten(text) {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
