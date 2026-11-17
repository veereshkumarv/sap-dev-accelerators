/**
 * What: CDS helpers: loads the project's own @sap/cds (fallback: bundled), resolves model roots,
 *     compiles to CSN, maps locations.
 * Why: Model-based rules need the compiled CSN; using the project's compiler version avoids
 *     version-mismatch false positives.
 * If missing or unlinked: The CDS model cannot be compiled, so authorization, naming and
 *     test-coverage rules cannot run.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Default CAP model roots (cds.env.roots) used when the project does not override folders. */
const DEFAULT_ROOTS = ['db/', 'srv/', 'app/', 'schema', 'services'];

/**
 * Loads @sap/cds from the analysed project when resolvable (so the project's own
 * compiler version is used), otherwise the version bundled with this tool.
 * @param {string} dir
 * @returns {Promise<any>}
 */
export async function loadCds(dir) {
  try {
    const resolved = createRequire(path.join(dir, 'package.json')).resolve('@sap/cds');
    const mod = await import(pathToFileURL(resolved).href);
    return mod.default ?? mod;
  } catch {
    const mod = await import('@sap/cds');
    return mod.default ?? mod;
  }
}

/**
 * Model roots from package.json / .cdsrc.json "folders" (read as data, never executed).
 * @param {any} pkgCds   package.json "cds" section
 * @param {any} cdsrc    .cdsrc.json content
 */
export function modelRoots(pkgCds, cdsrc) {
  const folders = { ...(cdsrc?.folders ?? {}), ...(pkgCds?.folders ?? {}) };
  const custom = Object.values(folders).filter((v) => typeof v === 'string');
  return [...new Set([...DEFAULT_ROOTS, ...custom])];
}

/**
 * Parses and compiles the project's CDS model to CSN. Only CDS sources are
 * parsed; no project JavaScript is executed.
 * @param {any} cds
 * @param {string} dir
 * @param {string[]} roots
 * @returns {Promise<any | undefined>} CSN, or undefined when the project has no CDS model.
 */
export async function compileModel(cds, dir, roots) {
  const files = cds.resolve(roots.map((r) => path.join(dir, r)));
  if (!files || files.length === 0) return undefined;
  return cds.load(files, { cwd: dir });
}

/**
 * True when a definition comes from the project itself (not node_modules / reuse packages).
 * @param {any} def
 */
export function isProjectDefinition(def) {
  const file = def?.$location?.file;
  return typeof file === 'string' && !file.startsWith('..') && !file.includes('node_modules');
}

/**
 * @param {any} def
 * @returns {{ file: string, line?: number, column?: number } | undefined}
 */
export function locationOf(def) {
  const loc = def?.$location;
  if (!loc?.file) return undefined;
  return {
    file: String(loc.file).replaceAll('\\', '/'),
    ...(loc.line ? { line: loc.line } : {}),
    ...(loc.col ? { column: loc.col } : {}),
  };
}
