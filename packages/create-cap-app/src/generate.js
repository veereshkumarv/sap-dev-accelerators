/**
 * What: Orchestrates project generation: validate options, run SAP's cds init/add, render the
 *     organisation overlay, merge package.json, derive xs-security.json roles from the model, add
 *     file headers, write docs/files.md and optionally npm install.
 * Why: One deterministic pipeline turns a name into a compliant, tested CAP project; SAP-owned
 *     scaffolding stays SAP's, organisation standards are layered on top.
 * If missing or unlinked: create-cap-app has nothing to run; the CLI and programmatic API fail
 *     to import generate().
 */
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, resolvePolicyDir } from '@sapdx/policy';
import { fileCatalog } from './catalog.js';
import { cds, npm } from './cds-dk.js';
import { renderFilesDoc, withHeader } from './headers.js';
import { deriveNames, OptionsError } from './options.js';
import { render } from './render.js';

const TEMPLATE_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
const SAPDX_PACKAGES = ['cap-policy-lint', 'policy'];
const SAPDX_VERSION = '0.1.0';
/** Test tooling cds init does not add: since CAP 10, cds.test lives in @cap-js/cds-test. */
const TEST_DEV_DEPENDENCIES = { '@cap-js/cds-test': '1.0.2' };
const HEADER_MARKERS = [/\bWhat:/, /\bWhy:/, /\bIf missing\b/i];

export class TargetError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'TargetError';
  }
}

export class GenerationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'GenerationError';
  }
}

/**
 * @typedef {import('./options.js').GenerateOptions & {
 *   policyDir?: string,
 *   skipInstall?: boolean,
 *   log?: (message: string) => void
 * }} Options
 */

/**
 * Generates a CAP project. The target folder must not exist or be empty; on failure a folder
 * created by this run is removed again.
 * @param {Options} options
 * @returns {Promise<{ root: string, files: string[], names: import('./options.js').Names }>}
 */
export async function generate(options) {
  const log = options.log ?? (() => {});
  const policy = await loadPolicy(await resolvePolicyDir(options.policyDir));
  if (!policy.naming) throw new OptionsError('Policy has no naming.yaml; cannot derive compliant names');
  const names = deriveNames(options, policy.naming);
  const parent = path.resolve(options.dir ?? process.cwd());
  const root = path.join(parent, names.projectName);
  await assertUsableTarget(root);
  await mkdir(parent, { recursive: true });

  try {
    log(`cds init ${names.projectName} --add ${names.facets.join(',')}`);
    await cds(['init', names.projectName, '--add', names.facets.join(',')], parent);

    // SAP's generic readme is replaced by README.md; on case-insensitive file systems both
    // names are the same file, so it must be removed before the overlay is written.
    await rm(path.join(root, 'readme.md'), { force: true });

    const catalog = fileCatalog(names);
    const values = templateValues(names);
    for (const entry of catalog.filter((e) => e.template)) {
      const template = await readFile(path.join(TEMPLATE_DIR, /** @type {string} */ (entry.template)), 'utf8');
      await writeOut(root, entry.path, render(template, values, entry.template));
    }

    await mergePackageJson(root, names, options.sapdxSource ?? 'registry');
    await appendGitignore(root);

    log('cds compile srv --to xsuaa');
    await writeSecurityDescriptor(root);

    const files = await listFiles(root);
    if (!files.includes('docs/files.md')) files.push('docs/files.md');
    files.sort();
    const byPath = new Map(catalog.map((e) => [e.path, e]));
    const unknown = files.filter((f) => !byPath.has(f));
    if (unknown.length) {
      throw new GenerationError(
        `No catalog entry (and therefore no header) for: ${unknown.join(', ')}. ` +
          'cds-dk output changed; add the files to src/catalog.js.',
      );
    }
    const present = files.map((f) => /** @type {import('./catalog.js').CatalogEntry} */ (byPath.get(f)));
    await writeOut(root, 'docs/files.md', renderFilesDoc(present, names.projectName));

    for (const entry of present) {
      const file = path.join(root, entry.path);
      const content = withHeader(entry, await readFile(file, 'utf8'));
      if (!entry.noInline && !HEADER_MARKERS.every((m) => m.test(content.split('\n').slice(0, 40).join('\n')))) {
        throw new GenerationError(`Header missing after generation in ${entry.path}`);
      }
      await writeFile(file, content);
    }

    if (!options.skipInstall) {
      log('npm install');
      await npm(['install', '--no-audit', '--no-fund'], root);
    }
    return { root, files, names };
  } catch (err) {
    await rm(root, { recursive: true, force: true });
    throw err;
  }
}

/** @param {import('./options.js').Names} names */
function templateValues(names) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const [k, v] of Object.entries(names)) if (typeof v === 'string') values[k] = v;
  return values;
}

/** @param {string} root */
async function assertUsableTarget(root) {
  let info;
  try {
    info = await stat(root);
  } catch {
    return;
  }
  if (!info.isDirectory() || (await readdir(root)).length > 0) {
    throw new TargetError(`Target ${root} already exists and is not empty; refusing to overwrite.`);
  }
  await rm(root, { recursive: true });
}

/**
 * @param {string} root
 * @param {import('./options.js').Names} names
 * @param {string} source  "registry" or path to the sap-dev-accelerators monorepo
 */
async function mergePackageJson(root, names, source) {
  const file = path.join(root, 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  // Real paths on both sides: npm resolves file: specs from the real project path, so a
  // relative path computed through a symlink (e.g. macOS /tmp -> /private/tmp) points nowhere.
  const realRoot = await realpath(root);
  const realSource = source === 'registry' ? '' : await realpath(path.resolve(source));
  /** @type {Record<string, string>} */
  const sapdx = {};
  for (const name of SAPDX_PACKAGES) {
    sapdx[`@sapdx/${name}`] =
      source === 'registry' ? SAPDX_VERSION : `file:${path.relative(realRoot, path.join(realSource, 'packages', name)).replaceAll('\\', '/')}`;
  }
  const merged = {
    name: names.npmName,
    version: pkg.version ?? '1.0.0',
    description: `CAP service ${names.service} (${names.entityLabel})`,
    private: true,
    type: pkg.type ?? 'module',
    // Node 24 LTS: required by the HANA deployer cds build generates (CAP 10) and supported by
    // the SAP runtime libraries; the CF buildpack selects the Node version from this range.
    engines: { node: '^24' },
    scripts: {
      ...pkg.scripts,
      watch: 'cds watch',
      lint: 'eslint .',
      test: 'node --test --experimental-test-coverage --test-coverage-include="srv/**" --test-coverage-include=server.js --test-coverage-lines=80 --test-coverage-functions=80 "test/*.test.js"',
      policy: 'cap-policy-lint .',
      'policy:sarif': 'cap-policy-lint . --format sarif --out reports/cap-policy.sarif',
      check: 'npm run lint && npm test && npm run policy',
    },
    dependencies: pkg.dependencies,
    devDependencies: sortKeys({ ...pkg.devDependencies, ...TEST_DEV_DEPENDENCIES, ...sapdx }),
    cds: {
      ...pkg.cds,
      requires: {
        ...pkg.cds?.requires,
        auth: {
          kind: 'mocked',
          users: { alice: { roles: ['Admin'] }, bob: { roles: ['Viewer'] } },
        },
      },
    },
  };
  await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
}

/** @param {string} root */
async function appendGitignore(root) {
  const file = path.join(root, '.gitignore');
  const current = await readFile(file, 'utf8').catch(() => '');
  await writeFile(file, `${current.trimEnd()}\n\n# Quality reports\nreports/\ncoverage/\n`);
}

/**
 * Derives scopes and role templates from the @restrict / @requires roles in the model and
 * merges them into the descriptor created by "cds add xsuaa" (keeps its other settings).
 * @param {string} root
 */
async function writeSecurityDescriptor(root) {
  const file = path.join(root, 'xs-security.json');
  const compiled = JSON.parse(await cds(['compile', 'srv', '--to', 'xsuaa'], root));
  const current = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
  const merged = { ...current, scopes: compiled.scopes ?? [], attributes: compiled.attributes ?? [], 'role-templates': compiled['role-templates'] ?? [] };
  if (!merged['role-templates'].length) throw new GenerationError('cds compile --to xsuaa produced no role templates; check @restrict roles');
  await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
}

/**
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 */
async function writeOut(root, rel, content) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

/**
 * @param {string} root
 * @returns {Promise<string[]>} relative POSIX paths, excluding node_modules
 */
async function listFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).replaceAll('\\', '/'))
    .filter((f) => !f.startsWith('node_modules/'));
}

/**
 * @param {Record<string, string>} obj
 */
function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}
