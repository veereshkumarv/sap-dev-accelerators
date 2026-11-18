/**
 * What: Offline verification of generated RAP files with abaplint: parses ABAP (ABAP Cloud
 *     language version), CDS view entities, metadata extensions, behavior definitions and table
 *     XML, and runs abaplint's syntax check on the ABAP code.
 * Why: Generated code must be proven syntactically valid before anyone imports it into an SAP
 *     system. The abaplint setup and its documented workarounds are shared with abap-policy-lint
 *     so generator and clean-core gate judge code identically.
 * If missing or unlinked: rap-scaffold --verify and the package tests cannot detect syntax errors;
 *     broken objects would only fail during activation in the SAP system.
 */
import { buildRegistry, collectIssues, GRAMMAR_GAPS, KNOWN_GAPS, UNPARSED_TYPES } from '@sapdx/abap-policy-lint/abaplint-compat';

export { GRAMMAR_GAPS, KNOWN_GAPS, UNPARSED_TYPES };

/**
 * abaplint rules used for verification: parser errors (all object types) and the ABAP syntax
 * check. Style rules are deliberately not used here - the clean-core gate owns those.
 */
const RULES = { parser_error: true, check_syntax: true, cds_parser_error: true, unknown_types: true };

/**
 * @param {Array<{ path: string, content: string }>} files
 * @param {{ dependencies?: Array<{ path: string, content: string }> }} [options]
 *   dependencies: existing objects (e.g. another abapGit repository) referenced by the model.
 */
export function verifyFiles(files, { dependencies = [] } = {}) {
  const { registry, normalized } = buildRegistry(
    files.filter((f) => f.path.startsWith('src/')),
    { rules: RULES, dependencies },
  );
  const { issues, knownGaps, unverified } = collectIssues(registry, normalized);
  return { issues, knownGaps, unverified, normalized, objects: registry.getObjectCount().normal };
}
