/**
 * What: Reads an abapGit / gCTS repository from disk: honours the STARTING_FOLDER in .abapgit.xml
 *     and returns all ABAP-relevant files with repository-relative POSIX paths.
 * Why: The linter must see exactly the objects abapGit would import - no more (README, CI files)
 *     and no less (objects below the starting folder).
 * If missing or unlinked: abap-policy-lint cannot load a repository and stops with an error.
 */
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_EXT = /\.(abap|xml|asddls|asdcls|asbdef|srvdsrv|asddlxs|acds|json)$/i;

export class RepositoryError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/**
 * @param {string} dir
 * @returns {Promise<{ root: string, startingFolder: string, files: Array<{ path: string, content: string }> }>}
 */
export async function loadRepository(dir) {
  let root;
  try {
    root = await realpath(path.resolve(dir));
  } catch {
    throw new RepositoryError(`Repository folder not found: ${dir}`);
  }
  let startingFolder = 'src/';
  try {
    const descriptor = await readFile(path.join(root, '.abapgit.xml'), 'utf8');
    const match = /<STARTING_FOLDER>([^<]*)<\/STARTING_FOLDER>/.exec(descriptor);
    if (match) startingFolder = `${match[1].replace(/^\/+|\/+$/g, '')}/`.replace(/^\/$/, '');
  } catch {
    // no descriptor: abapGit default
  }
  const base = path.join(root, startingFolder);
  let entries;
  try {
    entries = await readdir(base, { recursive: true, withFileTypes: true });
  } catch {
    throw new RepositoryError(`Starting folder "${startingFolder || '/'}" not found in ${root}`);
  }
  /** @type {Array<{ path: string, content: string }>} */
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || !SOURCE_EXT.test(e.name)) continue;
    const full = path.join(e.parentPath, e.name);
    const rel = path.relative(root, full).replaceAll('\\', '/');
    if (rel.split('/').some((part) => part === 'node_modules' || part.startsWith('.'))) continue;
    files.push({ path: rel, content: await readFile(full, 'utf8') });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { root, startingFolder, files };
}

/**
 * Reads every abapGit file below a folder (for --deps), ignoring the starting folder.
 * @param {string} dir
 */
export async function loadDependencyFiles(dir) {
  const root = path.resolve(dir);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  /** @type {Array<{ path: string, content: string }>} */
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || !SOURCE_EXT.test(e.name) || e.name === '.abapgit.xml') continue;
    const full = path.join(e.parentPath, e.name);
    files.push({ path: path.relative(root, full).replaceAll('\\', '/'), content: await readFile(full, 'utf8') });
  }
  return files;
}
