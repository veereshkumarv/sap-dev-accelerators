/**
 * What: Shared abaplint setup for offline ABAP checks: registry construction, normalisation of
 *     valid ABAP Cloud statements abaplint cannot parse, known false findings, stubs for
 *     SAP-delivered superclasses and the explicit behavior-definition parse check.
 * Why: The RAP generator (verification) and the ABAP clean-core lint must judge code the same
 *     way; one implementation keeps every workaround visible, documented and tested once.
 * If missing or unlinked: abap-policy-lint and rap-scaffold fail to import; if the workarounds
 *     drift apart, generated RAP code would pass one tool and fail the other.
 */
import { Config, MemoryFile, Objects, Registry, Version } from '@abaplint/core';

/**
 * Statements that are valid ABAP Cloud (used verbatim in SAP's RAP reference scenario) but not
 * modelled by abaplint's grammar. They are rewritten to their plain form in the in-memory copy
 * used for checking; the files themselves are never changed. Each rewrite is reported.
 */
export const GRAMMAR_GAPS = [
  { name: 'CLASS ... DEFINITION DEFERRED FOR TESTING', pattern: /(DEFINITION DEFERRED) FOR TESTING\./gi, replacement: '$1.' },
  { name: 'CREATE OBJECT ... FOR TESTING', pattern: /(CREATE OBJECT \w+) FOR TESTING\./gi, replacement: '$1.' },
];

/**
 * abaplint findings caused by RAP semantics it does not model. Returned separately as known gaps
 * (never silently dropped) so reviewers can see them.
 */
export const KNOWN_GAPS = [
  {
    name: 'implicit RAP handler parameters (failed/reported/mapped)',
    rule: 'check_syntax',
    message: /^Method changing parameter "(FAILED|REPORTED|MAPPED)" does not exist$/,
  },
  {
    // Only on lines rewritten from CREATE OBJECT ... FOR TESTING: RAP handlers cannot be created with NEW.
    name: 'CREATE OBJECT ... FOR TESTING cannot use NEW',
    rule: 'use_new',
    message: /./,
    normalizedLineOnly: true,
  },
];

/** Object types abaplint recognises but cannot parse; listed as not syntax-checked offline. */
export const UNPARSED_TYPES = new Set(['DCLS', 'SRVD', 'SRVB']);

/** Customer-namespace and local prefixes: SAP objects outside it are treated as void references. */
export const ERROR_NAMESPACE = '^(Z|Y|/[A-Z0-9]+/|LCL_|LHC_|LSC_|LTC_|LTD_|LIF_|TY_)';

const STUB_XML = (/** @type {string} */ name) =>
  `<?xml version="1.0" encoding="utf-8"?><abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS><CLSNAME>${name}</CLSNAME><LANGU>E</LANGU><DESCRIPT>stub</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE></VSEOCLASS></asx:values></asx:abap></abapGit>`;

/**
 * Minimal stand-ins for SAP-delivered objects that are not available offline but must be
 * resolvable (abaplint cannot treat superclasses as void).
 */
export const STUBS = [
  {
    path: '/stubs/cl_abap_behavior_handler.clas.abap',
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
  { path: '/stubs/cl_abap_behavior_handler.clas.xml', content: STUB_XML('CL_ABAP_BEHAVIOR_HANDLER') },
  {
    path: '/stubs/cl_abap_behavior_saver.clas.abap',
    content: 'CLASS cl_abap_behavior_saver DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.\n  PUBLIC SECTION.\n  PROTECTED SECTION.\nENDCLASS.\nCLASS cl_abap_behavior_saver IMPLEMENTATION.\nENDCLASS.',
  },
  { path: '/stubs/cl_abap_behavior_saver.clas.xml', content: STUB_XML('CL_ABAP_BEHAVIOR_SAVER') },
];

/**
 * @typedef {{ path: string, content: string }} SourceFile  path relative to the repository root, POSIX
 * @typedef {{ file: string, line: number, rule: string, message: string }} RawIssue
 */

/**
 * Builds and parses an abaplint registry for the given files.
 * @param {SourceFile[]} files      Files below the abapGit starting folder (path relative to repo root).
 * @param {{ version?: string, rules?: Record<string, unknown>, dependencies?: SourceFile[] }} [options]
 */
export function buildRegistry(files, { version = Version.Cloud, rules = {}, dependencies = [] } = {}) {
  const config = new Config(
    JSON.stringify({
      global: { files: '/**/*.*', exclude: [], noIssues: [], skipGeneratedGatewayClasses: true, skipGeneratedPersistentClasses: true, skipGeneratedFunctionGroups: true },
      dependencies: [],
      syntax: { version, errorNamespace: ERROR_NAMESPACE },
      rules,
    }),
  );
  const registry = new Registry(config);
  /** @type {Array<{ file: string, gap: string, count: number, lines: number[] }>} */
  const normalized = [];
  for (const f of files) {
    let content = f.content.replace(/^\uFEFF/, '');
    if (f.path.endsWith('.abap')) {
      for (const gap of GRAMMAR_GAPS) {
        const count = (content.match(gap.pattern) ?? []).length;
        if (count) {
          /** @type {number[]} */
          const lines = [];
          content.split('\n').forEach((line, i) => {
            if (new RegExp(gap.pattern.source, 'i').test(line)) lines.push(i + 1);
          });
          content = content.replace(gap.pattern, gap.replacement);
          normalized.push({ file: f.path, gap: gap.name, count, lines });
        }
      }
    }
    registry.addFile(new MemoryFile(`/${f.path}`, content));
  }
  for (const stub of STUBS) registry.addDependency(new MemoryFile(stub.path, stub.content));
  for (const dep of dependencies) registry.addDependency(new MemoryFile(`/deps/${dep.path.replace(/^\/+/, '')}`, dep.content.replace(/^\uFEFF/, '')));
  registry.parse();
  return { registry, normalized };
}

/**
 * Issues for the project files (dependencies excluded), with the explicit behavior-definition
 * parse check added (abaplint parses BDEF but never reports parse failures). Splits known gaps
 * from real issues and lists objects that cannot be checked offline.
 * @param {import('@abaplint/core').IRegistry} registry
 * @param {Array<{ file: string, lines: number[] }>} [normalized]  from buildRegistry
 */
export function collectIssues(registry, normalized = []) {
  const rewritten = new Set(normalized.flatMap((n) => n.lines.map((l) => `${n.file}:${l}`)));
  /** @type {RawIssue[]} */
  const all = registry
    .findIssues()
    .filter((i) => !i.getFilename().startsWith('/stubs/') && !i.getFilename().startsWith('/deps/'))
    .map((i) => ({ file: i.getFilename().replace(/^\//, ''), line: i.getStart().getRow(), rule: i.getKey(), message: i.getMessage() }));
  /** @type {string[]} */
  const unverified = [];
  for (const obj of registry.getObjects()) {
    const file = obj.getFiles()[0]?.getFilename() ?? '';
    if (file.startsWith('/stubs/') || file.startsWith('/deps/')) continue;
    if (obj instanceof Objects.BehaviorDefinition && (obj.hasParserError() || !obj.getTree())) {
      const source = obj.getFiles().find((f) => f.getFilename().endsWith('.asbdef'))?.getFilename() ?? file;
      all.push({ file: source.replace(/^\//, ''), line: 1, rule: 'bdef_parser_error', message: 'Behavior definition does not parse' });
    }
    if (UNPARSED_TYPES.has(obj.getType())) unverified.push(`${obj.getType()} ${obj.getName()}`);
  }
  all.sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.rule, b.rule));
  const gapOf = (/** @type {RawIssue} */ i) =>
    KNOWN_GAPS.find((g) => g.rule === i.rule && g.message.test(i.message) && (!g.normalizedLineOnly || rewritten.has(`${i.file}:${i.line}`)));
  return {
    issues: all.filter((i) => !gapOf(i)),
    knownGaps: all.filter((i) => gapOf(i)).map((i) => ({ ...i, gap: /** @type {{ name: string }} */ (gapOf(i)).name })),
    unverified: unverified.sort(compare),
  };
}

/**
 * Locale-independent ordering (deterministic output on every machine).
 * @param {string} a
 * @param {string} b
 */
export function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export { Version };
