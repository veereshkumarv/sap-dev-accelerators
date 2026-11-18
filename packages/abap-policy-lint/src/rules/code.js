/**
 * What: Statement-level clean-core rules for ABAP code: released-API usage (ABAP-CC-001/005),
 *     forbidden tables/function modules/classes (ABAP-CC-003/004), unbounded SELECTs
 *     (ABAP-PERF-002), cross-client access (ABAP-DB-001), hard-coded organisational values and URLs
 *     (ABAP-CFG-001), plus mapping of abaplint findings to policy rule ids.
 * Why: These are the code patterns that break clean core, security or performance most often; they
 *     are detected from abaplint's syntax tree, not from text search, to avoid false positives.
 * If missing or unlinked: The ABAP gate only checks object-level rules; unreleased API usage and
 *     risky statements pass unnoticed.
 */
import { ArtifactsRules, Expressions, Statements } from '@abaplint/core';

/** @typedef {import('../lint.js').RuleContext} RuleContext */

/** abaplint rule key -> policy rule id (anything else in the curated profile -> ABAP-LINT-<KEY>). */
export const ISSUE_MAP = {
  parser_error: 'ABAP-LANG-001',
  cds_parser_error: 'ABAP-SYNTAX-001',
  bdef_parser_error: 'ABAP-SYNTAX-001',
  check_syntax: 'ABAP-SYNTAX-001',
  unknown_types: 'ABAP-SYNTAX-001',
  db_operation_in_loop: 'ABAP-PERF-001',
  dangerous_statement: 'ABAP-SEC-002',
};

/** Curated abaplint profile: rules that matter for quality without style noise. */
export const ABAPLINT_RULES = {
  parser_error: true,
  cds_parser_error: true,
  check_syntax: true,
  unknown_types: true,
  db_operation_in_loop: true,
  // Dynamic SQL is common and legitimate; injection risk is covered by sql_escape_host_variables.
  // abaplint replaces (not merges) rule configuration, so start from its defaults.
  dangerous_statement: { ...ruleDefaults('dangerous_statement'), dynamicSQL: false },
  unused_variables: true,
  unused_types: true,
  empty_statement: true,
  obsolete_statement: true,
  prefer_xsdbool: true,
  use_new: true,
  strict_sql: true,
  sql_escape_host_variables: true,
};

/** @param {string} key */
function ruleDefaults(key) {
  const rule = ArtifactsRules.getRules().find((r) => r.getMetadata().key === key);
  // IRule types getConfig() as void; concrete rules return their configuration object.
  return rule ? { .../** @type {any} */ (rule).getConfig() } : {};
}

const BUILTIN_TYPES = new Set(
  'i int8 f p c n d t x string xstring decfloat16 decfloat34 utclong any data object simple numeric clike csequence xsequence table index sorted hashed standard me super sy syst abap_bool'.split(' '),
);
const ORG_FIELDS = '(bukrs|werks|vkorg|vtweg|spart|companycode|plant|salesorganization|distributionchannel)';
const ORG_VALUE = new RegExp(`\\b${ORG_FIELDS}\\s*(=|EQ|<>|NE)\\s*['\`]([^'\`]*)['\`]|['\`]([^'\`]*)['\`]\\s*(=|EQ|<>|NE)\\s*[\\w-]*\\b${ORG_FIELDS}\\b`, 'i');

/**
 * Applies the abaplint-issue mapping.
 * @param {RuleContext} ctx
 * @param {Array<{ file: string, line: number, rule: string, message: string }>} issues
 */
export function reportAbaplintIssues({ report, objectOfFile }, issues) {
  for (const i of issues) {
    const ruleId = /** @type {Record<string, string>} */ (ISSUE_MAP)[i.rule] ?? `ABAP-LINT-${i.rule.toUpperCase()}`;
    const message = i.rule === 'parser_error' ? `Statement not permitted in the configured ABAP language version, or unparsable: ${i.message}` : i.message;
    report(ruleId, message, { object: objectOfFile(i.file), location: { file: i.file, line: i.line } });
  }
}

/**
 * Statement-level rules over every ABAP source file.
 * @param {RuleContext} ctx
 */
export function checkStatements(ctx) {
  const { registry, report, policy, released, isCustomer } = ctx;
  const forbidden = {
    tables: new Map((policy.forbiddenObjects?.tables ?? []).map((/** @type {any} */ o) => [o.name, o.successor])),
    functions: new Map((policy.forbiddenObjects?.functionModules ?? []).map((/** @type {any} */ o) => [o.name, o.successor])),
    classes: new Map((policy.forbiddenObjects?.classes ?? []).map((/** @type {any} */ o) => [o.name, o.successor])),
  };

  for (const obj of registry.getObjects()) {
    if (!('getABAPFiles' in obj) || typeof obj.getABAPFiles !== 'function') continue;
    const first = obj.getFiles()[0]?.getFilename() ?? '';
    if (first.startsWith('/stubs/') || first.startsWith('/deps/')) continue;
    const object = `${obj.getType()} ${obj.getName()}`;
    const files = /** @type {any[]} */ (obj.getABAPFiles());
    const local = localNames(files);
    /** @type {Set<string>} */
    const seen = new Set();

    for (const file of files) {
      const path = file.getFilename().replace(/^\//, '');
      for (const s of file.getStatements()) {
        const line = s.getFirstToken().getStart().getRow();
        const at = { object, location: { file: path, line } };
        const text = s.concatTokens();
        const upper = text.toUpperCase();
        const type = s.get();

        // ---- references: forbidden objects first, then released-API catalogue
        for (const ref of references(s, local, isCustomer)) {
          const key = `${ref.kind}:${ref.name}`;
          // A DDIC table used as a type is still the forbidden table (with its released successor).
          const asTable = ref.kind === 'table' || (ref.kind === 'type' && forbidden.tables.has(ref.name));
          const forbiddenSuccessor = asTable
            ? forbidden.tables.get(ref.name)
            : ref.kind === 'function'
              ? forbidden.functions.get(ref.name)
              : forbidden.classes.get(ref.name);
          if (forbiddenSuccessor !== undefined) {
            const ruleId = asTable ? 'ABAP-CC-003' : 'ABAP-CC-004';
            if (!seen.has(`${ruleId}:${key}`)) report(ruleId, `${describe(ref)} ${ref.name} is forbidden by policy; use ${forbiddenSuccessor}.`, at);
            seen.add(`${ruleId}:${key}`);
            continue;
          }
          if (!released || seen.has(key)) continue;
          seen.add(key);
          const entry = released.lookup(ref.name);
          if (!entry || entry.state === 'notToBeReleased') {
            report('ABAP-CC-001', `${describe(ref)} ${ref.name} is not a released SAP API (${released.variant}).${entry?.successor ? ` Successor: ${entry.successor}.` : ''}`, at);
          } else if (entry.state === 'deprecated') {
            report('ABAP-CC-005', `${describe(ref)} ${ref.name} is deprecated${entry.successor ? `; use ${entry.successor}` : ''}.`, at);
          }
        }

        // ---- SQL rules
        if (type instanceof Statements.Select || type instanceof Statements.SelectLoop) {
          if (!/\bWHERE\b|\bUP TO\b|^SELECT SINGLE\b/.test(upper) && !/\bFROM\s+@/.test(upper)) {
            report('ABAP-PERF-002', 'SELECT without WHERE and without UP TO / SINGLE reads the whole table.', at);
          }
        }
        if (/\bCLIENT SPECIFIED\b|\bUSING\s+(ALL\s+)?CLIENTS?\b/.test(upper)) {
          report('ABAP-DB-001', 'Cross-client database access bypasses automatic client handling.', at);
        }

        // ---- hard-coded configuration
        const org = ORG_VALUE.exec(text);
        if (org) {
          const field = (org[1] ?? org[6]).toLowerCase();
          const value = org[3] ?? org[4];
          report('ABAP-CFG-001', `Hard-coded ${field} value '${value}'; read organisational values from configuration.`, { ...at, object: `${object}#${field}=${value}` });
        }
        for (const token of s.getTokens()) {
          const str = token.getStr();
          if (/^['`|]https?:\/\//i.test(str)) {
            report('ABAP-CFG-001', `Hard-coded URL ${str.slice(1, 60)}; use a communication arrangement / destination.`, { ...at, object: `${object}#url` });
          }
        }
      }
    }
  }
}

/**
 * @param {{ kind: string }} ref
 */
function describe(ref) {
  return { class: 'Class/interface', function: 'Function module', table: 'Table/view', type: 'Type' }[ref.kind] ?? 'Object';
}

/**
 * Names declared locally in the object (types, local classes/interfaces) - never SAP objects.
 * @param {any[]} files
 */
function localNames(files) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const file of files) {
    for (const s of file.getStatements()) {
      const t = s.get();
      if (t instanceof Statements.Type || t instanceof Statements.TypeBegin || t instanceof Statements.TypeEnumBegin || t instanceof Statements.TypeMesh) {
        const n = s.findFirstExpression(Expressions.NamespaceSimpleName);
        if (n) names.add(n.concatTokens().toUpperCase());
      }
      if (t instanceof Statements.ClassDefinition || t instanceof Statements.ClassDeferred || t instanceof Statements.Interface || t instanceof Statements.InterfaceDeferred) {
        const n = s.findFirstExpression(Expressions.ClassName) ?? s.findFirstExpression(Expressions.InterfaceName);
        if (n) names.add(n.concatTokens().toUpperCase());
      }
    }
  }
  return names;
}

/**
 * SAP object references of one statement (customer, local and built-in names excluded).
 * @param {any} s  abaplint StatementNode
 * @param {Set<string>} local
 * @param {(name: string) => boolean} isCustomer
 * @returns {Array<{ kind: 'class' | 'function' | 'table' | 'type', name: string }>}
 */
function references(s, local, isCustomer) {
  /** @type {Array<{ kind: 'class' | 'function' | 'table' | 'type', name: string }>} */
  const refs = [];
  const add = (/** @type {'class' | 'function' | 'table' | 'type'} */ kind, /** @type {string} */ raw) => {
    const name = raw.toUpperCase();
    if (!name || BUILTIN_TYPES.has(name.toLowerCase()) || local.has(name) || isCustomer(name)) return;
    if (/^(L[A-Z]{1,2}_|TY_|TT_|GTY_)/.test(name)) return;
    refs.push({ kind, name });
  };
  const t = s.get();
  const isDefinition = t instanceof Statements.ClassDefinition || t instanceof Statements.ClassImplementation;
  if (isDefinition) {
    const sup = s.findFirstExpression(Expressions.SuperClassName);
    if (sup) add('class', sup.concatTokens());
  } else {
    for (const e of s.findAllExpressions(Expressions.ClassName)) add('class', e.concatTokens());
  }
  if (t instanceof Statements.InterfaceDef) {
    for (const e of s.findAllExpressions(Expressions.InterfaceName)) add('class', e.concatTokens());
  }
  // RAP handler declarations (FOR VALIDATE ON SAVE ... FOR Order~x, FOR GLOBAL AUTHORIZATION ...)
  // name entity aliases, not types.
  const rapHandler = t instanceof Statements.MethodDef && /\bFOR\s+(VALIDATE|DETERMINE|GLOBAL|INSTANCE|MODIFY|READ|LOCK|FEATURES|NUMBERING|PRECHECK|DETERMINATION|SAVE|CREATE|UPDATE|DELETE|ACTION)\b/i.test(s.concatTokens());
  for (const e of rapHandler ? [] : s.findAllExpressions(Expressions.TypeName)) {
    const text = e.concatTokens();
    if (text.includes('~')) continue;
    if (text.includes('=>')) add('class', text.split('=>')[0]);
    else if (new RegExp(`REF TO ${text.replace(/[^\w/]/g, '')}\\b`, 'i').test(s.concatTokens())) add('class', text);
    else add('type', text.split('-')[0]);
  }
  for (const e of s.findAllExpressions(Expressions.FunctionName)) {
    const text = e.concatTokens();
    if (/^'[^']+'$/.test(text)) add('function', text.slice(1, -1));
  }
  for (const e of s.findAllExpressions(Expressions.SQLFromSource)) {
    const first = e.getFirstToken().getStr();
    if (!first.startsWith('@') && !first.startsWith('(')) add('table', first);
  }
  return refs;
}
