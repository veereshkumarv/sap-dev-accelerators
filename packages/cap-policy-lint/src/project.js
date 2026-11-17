/**
 * What: Reads a CAP project: file list, package.json, .cdsrc.json, compiled model and cached
 *     parsed JS files.
 * Why: Gives all rules one consistent, read-only view of the project and reports invalid JSON/CDS
 *     clearly.
 * If missing or unlinked: Rules have no project data; lintProject fails before any check runs.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileModel, loadCds, modelRoots } from './cds.js';
import { parseJs } from './js.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'gen', 'coverage', 'mta_archives', 'dist', '@cds-models']);
const JS_EXT = /\.(c|m)?js$/;

export class LintError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'LintError';
  }
}

/**
 * @typedef {object} JsFile
 * @property {string} file  POSIX path relative to project root
 * @property {string} source
 * @property {any} ast
 *
 * @typedef {object} Project
 * @property {string} dir
 * @property {string[]} files       All project files (relative POSIX paths, sorted).
 * @property {any} pkg              package.json content (or {})
 * @property {any} cdsrc            .cdsrc.json content (or undefined)
 * @property {any} csn              Compiled model (or undefined)
 * @property {(file: string) => Promise<string>} read
 * @property {(prefix: string) => Promise<JsFile[]>} jsFiles  Parsed JS files below a folder.
 */

/**
 * Collects everything the rules need. Reads and parses only — never executes
 * project code.
 * @param {string} dir absolute project directory
 * @returns {Promise<Project>}
 */
export async function loadProject(dir) {
  const files = (await listFiles(dir)).sort();
  /** @type {Map<string, string>} */
  const cache = new Map();
  const read = async (/** @type {string} */ file) => {
    let text = cache.get(file);
    if (text === undefined) {
      text = await readFile(path.join(dir, file), 'utf8');
      cache.set(file, text);
    }
    return text;
  };

  const pkg = files.includes('package.json') ? parseJson(await read('package.json'), 'package.json') : {};
  const cdsrc = files.includes('.cdsrc.json') ? parseJson(await read('.cdsrc.json'), '.cdsrc.json') : undefined;

  const cds = await loadCds(dir);
  let csn;
  try {
    csn = await compileModel(cds, dir, modelRoots(pkg.cds, cdsrc));
  } catch (err) {
    throw new LintError(`CDS model does not compile: ${/** @type {Error} */ (err).message}`);
  }

  /** @type {Map<string, JsFile | null>} */
  const parsed = new Map();
  const jsFiles = async (/** @type {string} */ prefix) => {
    /** @type {JsFile[]} */
    const out = [];
    for (const file of files) {
      if (!file.startsWith(prefix) || !JS_EXT.test(file)) continue;
      if (!parsed.has(file)) {
        const source = await read(file);
        const ast = parseJs(source);
        parsed.set(file, ast ? { file, source, ast } : null);
      }
      const entry = parsed.get(file);
      if (entry) out.push(entry);
    }
    return out;
  };

  return { dir, files, pkg, cdsrc, csn, read, jsFiles };
}

/**
 * @param {string} text
 * @param {string} name
 */
function parseJson(text, name) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new LintError(`Invalid JSON in ${name}: ${/** @type {Error} */ (err).message}`);
  }
}

/**
 * @param {string} root
 * @param {string} [rel]
 * @returns {Promise<string[]>}
 */
async function listFiles(root, rel = '') {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  /** @type {string[]} */
  const out = [];
  for (const e of entries) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...(await listFiles(root, child)));
    } else if (e.isFile()) {
      out.push(child);
    }
  }
  return out;
}

