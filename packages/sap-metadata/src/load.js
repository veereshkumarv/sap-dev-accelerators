/**
 * What: Loads a service model from any supported input: an EDMX file (V2/V4, e.g. downloaded
 *     $metadata of an S/4HANA or RAP service), a CAP project folder (compiled per service to V4
 *     EDMX with the CDS compiler) or a snapshot JSON written earlier.
 * Why: Teams diff and test against what they have - a CAP project in the repo, a $metadata file
 *     of a RAP/S/4 service, or the snapshot of the last release - through one function.
 * If missing or unlinked: CLIs of odata-diff and odata-testgen cannot open their inputs.
 */
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromEdmx, MetadataError, mergeModels, parseSnapshot } from './model.js';

/**
 * @param {string} input  file (.xml/.edmx/.json) or CAP project directory
 * @returns {Promise<import('./model.js').ServiceModel>}
 */
export async function loadServiceModel(input) {
  let info;
  try {
    info = await stat(input);
  } catch {
    throw new MetadataError(`Input not found: ${input}`);
  }
  if (info.isDirectory()) return fromCapProject(input);
  const text = await readFile(input, 'utf8');
  if (/^\s*\{/.test(text)) {
    try {
      return parseSnapshot(JSON.parse(text));
    } catch (err) {
      throw err instanceof MetadataError ? err : new MetadataError(`Invalid snapshot JSON: ${input}`);
    }
  }
  return fromEdmx(text);
}

/**
 * Compiles every service of a CAP project to OData V4 EDMX and normalises it. Uses the project's
 * own @sap/cds when installed (same compiler version as the app), else the bundled one. Parses
 * models only - never executes project code.
 * @param {string} dir
 */
export async function fromCapProject(dir) {
  const cds = await loadCds(dir);
  const files = cds.resolve(['db/', 'srv/', 'app/', 'schema', 'services'].map((r) => path.join(dir, r)));
  if (!files?.length) throw new MetadataError(`No CDS model found in ${dir}`);
  let csn;
  try {
    csn = await cds.load(files, { cwd: dir });
  } catch (err) {
    throw new MetadataError(`CDS model does not compile: ${/** @type {Error} */ (err).message}`);
  }
  const services = Object.entries(csn.definitions)
    .filter(([, d]) => /** @type {any} */ (d).kind === 'service')
    .map(([name]) => name)
    .sort();
  if (!services.length) throw new MetadataError(`CAP project ${dir} defines no service`);
  return mergeModels(services.map((service) => fromEdmx(cds.compile.to.edmx(csn, { service, version: 'v4' }))));
}

/**
 * Loads the CSN of a CAP project (for role and permission derivation in odata-testgen).
 * @param {string} dir
 */
export async function loadCsn(dir) {
  const cds = await loadCds(dir);
  const files = cds.resolve(['db/', 'srv/', 'app/', 'schema', 'services'].map((r) => path.join(dir, r)));
  return files?.length ? cds.load(files, { cwd: dir }) : undefined;
}

/**
 * CAP project facts needed for test generation: mocked users as CAP resolves them (project
 * configuration merged with CAP defaults) and the URL path of each service.
 * @param {string} dir
 * @returns {Promise<{ users: Record<string, any>, paths: Record<string, string> }>}
 */
export async function loadCapProjectInfo(dir) {
  const cds = await loadCds(dir);
  const users = cds.env.for('cds', path.resolve(dir)).requires?.auth?.users ?? {};
  const csn = await loadCsn(dir);
  /** @type {Record<string, string>} */
  const paths = {};
  for (const [name, def] of Object.entries(csn?.definitions ?? {})) {
    if (/** @type {any} */ (def).kind !== 'service') continue;
    const annotated = /** @type {any} */ (def)['@path'];
    // CAP default: service name without "Service", kebab-case, below /odata/v4/; absolute @path is used as-is.
    const local = name.split('.').pop() ?? name;
    const derived = local.replace(/Service$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const p = typeof annotated === 'string' ? annotated : derived;
    paths[name] = p.startsWith('/') ? p : `/odata/v4/${p}`;
  }
  return { users, paths };
}

/** @param {string} dir */
async function loadCds(dir) {
  try {
    const resolved = createRequire(path.join(path.resolve(dir), 'package.json')).resolve('@sap/cds');
    const mod = await import(pathToFileURL(resolved).href);
    return mod.default ?? mod;
  } catch {
    const mod = await import('@sap/cds');
    return mod.default ?? mod;
  }
}
