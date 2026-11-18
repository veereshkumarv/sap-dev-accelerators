/**
 * What: Offline verification of generated RAP files with abaplint: parses ABAP (ABAP Cloud
 *     language version), CDS view entities, metadata extensions, behavior definitions and table
 *     XML, and runs abaplint's syntax check on the ABAP code.
 * Why: Generated code must be proven syntactically valid before anyone imports it into an SAP
 *     system; this is the strongest check available without a system.
 * If missing or unlinked: rap-scaffold --verify and the package tests cannot detect syntax errors;
 *     broken objects would only fail during activation in the SAP system.
 */
import { Config, MemoryFile, Objects, Registry, Version } from '@abaplint/core';

/** Customer namespace and local class prefixes; SAP objects outside it are treated as void. */
export const ERROR_NAMESPACE = '^(Z|Y|LCL_|LHC_|LTC_|LSC_|TY_|LIF_)';

/**
 * abaplint rules used for verification: parser errors (all object types) and the ABAP syntax
 * check. Style rules are deliberately not used here - the clean-core gate owns those.
 */
const RULES = { parser_error: true, check_syntax: true, cds_parser_error: true, unknown_types: true };

/**
 * Object types abaplint recognises but cannot parse; reported as not syntax-checked offline so a
 * clean result never overstates what was verified.
 */
export const UNPARSED_TYPES = new Set(['DCLS', 'SRVD', 'SRVB']);

/**
 * Statements that are valid ABAP Cloud (used verbatim in SAP's RAP reference scenario) but not
 * modelled by abaplint's grammar. They are rewritten to their plain form in the in-memory copy
 * used for verification only; the generated files are never changed. Each rewrite is reported.
 */
export const GRAMMAR_GAPS = [
  { name: 'CLASS ... DEFINITION DEFERRED FOR TESTING', pattern: /(DEFINITION DEFERRED) FOR TESTING\./g, replacement: '$1.' },
  { name: 'CREATE OBJECT ... FOR TESTING', pattern: /(CREATE OBJECT \w+) FOR TESTING\./g, replacement: '$1.' },
];

/**
 * abaplint findings caused by RAP semantics it does not model. They are returned separately as
 * knownGaps (never silently dropped) so reviewers can see them.
 */
export const KNOWN_GAPS = [
  {
    name: 'implicit RAP handler parameters (failed/reported/mapped)',
    rule: 'check_syntax',
    message: /^Method changing parameter "(FAILED|REPORTED|MAPPED)" does not exist$/,
  },
];

/**
 * Minimal stand-ins for SAP-delivered objects that are not available offline but must be
 * resolvable (superclasses cannot be treated as void by abaplint).
 */
const STUBS = [
  {
    path: '/deps/cl_abap_behavior_handler.clas.abap',
    // Protected message factories inherited by every RAP handler class.
    content: [
      'CLASS cl_abap_behavior_handler DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.',
      '  PUBLIC SECTION.',
      '  PROTECTED SECTION.',
      '    METHODS new_message_with_text IMPORTING severity TYPE any OPTIONAL text TYPE csequence OPTIONAL RETURNING VALUE(obj) TYPE REF TO object.',
      '    METHODS new_message IMPORTING id TYPE csequence number TYPE csequence severity TYPE any v1 TYPE any OPTIONAL v2 TYPE any OPTIONAL v3 TYPE any OPTIONAL v4 TYPE any OPTIONAL RETURNING VALUE(obj) TYPE REF TO object.',
      'ENDCLASS.',
      'CLASS cl_abap_behavior_handler IMPLEMENTATION.',
      '  METHOD new_message_with_text.',
      '  ENDMETHOD.',
      '  METHOD new_message.',
      '  ENDMETHOD.',
      'ENDCLASS.',
    ].join('\n'),
  },
  {
    path: '/deps/cl_abap_behavior_handler.clas.xml',
    content:
      '<?xml version="1.0" encoding="utf-8"?><abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS><CLSNAME>CL_ABAP_BEHAVIOR_HANDLER</CLSNAME><LANGU>E</LANGU><DESCRIPT>stub</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE></VSEOCLASS></asx:values></asx:abap></abapGit>',
  },
];

/**
 * @param {Array<{ path: string, content: string }>} files
 * @param {{ dependencies?: Array<{ path: string, content: string }> }} [options]
 *   dependencies: existing objects (e.g. another abapGit repository) referenced by the model.
 * @returns {{
 *   issues: Array<{ file: string, line: number, rule: string, message: string }>,
 *   knownGaps: Array<{ file: string, line: number, rule: string, message: string, gap: string }>,
 *   objects: number,
 *   normalized: Array<{ file: string, gap: string, count: number }>,
 *   unverified: string[]
 * }}
 */
export function verifyFiles(files, { dependencies = [] } = {}) {
  const config = new Config(
    JSON.stringify({
      global: { files: '/src/**/*.*', exclude: [], noIssues: [], skipGeneratedGatewayClasses: true, skipGeneratedPersistentClasses: true, skipGeneratedFunctionGroups: true },
      dependencies: [],
      syntax: { version: Version.Cloud, errorNamespace: ERROR_NAMESPACE },
      rules: RULES,
    }),
  );
  const registry = new Registry(config);
  /** @type {Array<{ file: string, gap: string, count: number }>} */
  const normalized = [];
  for (const f of files) {
    if (!f.path.startsWith('src/')) continue;
    let content = f.content.replace(/^\uFEFF/, '');
    if (f.path.endsWith('.abap')) {
      for (const gap of GRAMMAR_GAPS) {
        const count = (content.match(gap.pattern) ?? []).length;
        if (count) {
          content = content.replace(gap.pattern, gap.replacement);
          normalized.push({ file: f.path, gap: gap.name, count });
        }
      }
    }
    registry.addFile(new MemoryFile(`/${f.path}`, content));
  }
  for (const stub of STUBS) registry.addDependency(new MemoryFile(stub.path, stub.content));
  for (const dep of dependencies) registry.addDependency(new MemoryFile(`/deps/${dep.path.replace(/^\/+/, '')}`, dep.content.replace(/^\uFEFF/, '')));
  registry.parse();
  const all = registry.findIssues().filter((i) => i.getFilename().startsWith('/src/')).map((i) => ({
    file: i.getFilename().replace(/^\//, ''),
    line: i.getStart().getRow(),
    rule: i.getKey(),
    message: i.getMessage(),
  }));

  /** @type {string[]} */
  const unverified = [];
  for (const obj of registry.getObjects()) {
    const file = obj.getFiles().find((f) => f.getFilename().startsWith('/src/'))?.getFilename();
    if (!file) continue;
    // abaplint parses behavior definitions but never reports parse failures as issues.
    if (obj instanceof Objects.BehaviorDefinition && (obj.hasParserError() || !obj.getTree())) {
      const source = obj.getFiles().find((f) => f.getFilename().endsWith('.asbdef'))?.getFilename() ?? file;
      all.push({ file: source.replace(/^\//, ''), line: 1, rule: 'bdef_parser_error', message: 'Behavior definition does not parse' });
    }
    if (UNPARSED_TYPES.has(obj.getType())) unverified.push(`${obj.getType()} ${obj.getName()}`);
  }

  all.sort((a, b) => compare(a.file, b.file) || a.line - b.line);
  const gapOf = (/** @type {{ rule: string, message: string }} */ i) => KNOWN_GAPS.find((g) => g.rule === i.rule && g.message.test(i.message));
  const issues = all.filter((i) => !gapOf(i));
  const knownGaps = all.filter((i) => gapOf(i)).map((i) => ({ ...i, gap: /** @type {{ name: string }} */ (gapOf(i)).name }));
  return { issues, knownGaps, objects: registry.getObjectCount().normal, normalized, unverified: unverified.sort(compare) };
}

/**
 * Locale-independent ordering (deterministic output on every machine).
 * @param {string} a
 * @param {string} b
 */
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
