/**
 * What: Released-API catalogue: downloads SAP's Cloudification Repository release information
 *     (BTP ABAP Environment, S/4HANA Cloud Public or Private Cloud Edition), stores it in a compact
 *     cache file and answers "is this SAP object released, deprecated or not released?".
 * Why: Clean core means using only released (C1) SAP APIs; SAP publishes the authoritative list
 *     at github.com/SAP/abap-atc-cr-cv-s4hc. Caching keeps lint runs offline and reproducible.
 * If missing or unlinked: The unreleased-API rule (ABAP-CC-001) and deprecated-API rule
 *     (ABAP-CC-005) cannot run; the linter reports them as skipped.
 */
import { readFile } from 'node:fs/promises';

export const SOURCE_BASE = 'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/';

/** Release-information file per target platform. */
export const VARIANTS = Object.freeze({
  btp: 'objectReleaseInfo_BTPLatest.json',
  public: 'objectReleaseInfoLatest.json',
  pce: 'objectReleaseInfo_PCELatest.json',
});

export class ReleasedApisError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ReleasedApisError';
  }
}

/**
 * @typedef {[tadirObject: string, tadirObjName: string, objectType: string, objectKey: string, state: string, successor: string]} CompactEntry
 * @typedef {{ formatVersion: 1, source: string, variant: string, objects: CompactEntry[] }} CompactCatalogue
 */

/**
 * Converts SAP's objectReleaseInfo JSON into the compact cache format (sorted, successor names only).
 * @param {any} raw
 * @param {string} variant
 * @returns {CompactCatalogue}
 */
export function compactReleaseInfo(raw, variant) {
  const list = raw?.objectReleaseInfo;
  if (!Array.isArray(list)) throw new ReleasedApisError('Not an SAP objectReleaseInfo document (objectReleaseInfo[] missing)');
  /** @type {CompactEntry[]} */
  const objects = list
    .filter((o) => o && typeof o.tadirObjName === 'string' && typeof o.state === 'string')
    .map((o) => [
      String(o.tadirObject ?? ''),
      o.tadirObjName.toUpperCase(),
      String(o.objectType ?? ''),
      String(o.objectKey ?? o.tadirObjName).toUpperCase(),
      o.state,
      (o.successors ?? []).map((/** @type {any} */ s) => s.objectKey ?? s.tadirObjName).filter(Boolean).join(', '),
    ]);
  objects.sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1));
  return { formatVersion: 1, source: `${SOURCE_BASE}${/** @type {Record<string, string>} */ (VARIANTS)[variant] ?? variant}`, variant, objects };
}

/**
 * Downloads the release information for a variant (explicit network call with timeout).
 * @param {string} variant  btp | public | pce
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function downloadReleasedApis(variant, { fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  const file = /** @type {Record<string, string>} */ (VARIANTS)[variant];
  if (!file) throw new ReleasedApisError(`Unknown variant "${variant}" (use ${Object.keys(VARIANTS).join(', ')})`);
  const response = await fetchImpl(`${SOURCE_BASE}${file}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new ReleasedApisError(`Download failed: HTTP ${response.status} for ${SOURCE_BASE}${file}`);
  return compactReleaseInfo(await response.json(), variant);
}

/**
 * @typedef {object} ReleasedApis
 * @property {string} variant
 * @property {string} source
 * @property {number} size
 * @property {(name: string) => { state: string, successor: string } | undefined} lookup
 */

/**
 * @param {CompactCatalogue} catalogue
 * @returns {ReleasedApis}
 */
export function indexCatalogue(catalogue) {
  if (catalogue?.formatVersion !== 1 || !Array.isArray(catalogue.objects)) {
    throw new ReleasedApisError('Invalid released-API cache (expected formatVersion 1); run update-released-apis');
  }
  /** @type {Map<string, { state: string, successor: string }>} */
  const byName = new Map();
  const rank = { released: 0, deprecated: 1 };
  for (const [, name, , key, state, successor] of catalogue.objects) {
    for (const n of new Set([name, key])) {
      const current = byName.get(n);
      // An object can appear with several types (e.g. DOMA and DTEL); the best state wins.
      const better = !current || (/** @type {Record<string, number>} */ (rank)[state] ?? 9) < (/** @type {Record<string, number>} */ (rank)[current.state] ?? 9);
      if (better) byName.set(n, { state, successor });
    }
  }
  return {
    variant: catalogue.variant,
    source: catalogue.source,
    size: catalogue.objects.length,
    lookup: (name) => byName.get(name.toUpperCase()),
  };
}

/**
 * @param {string} file  compact cache written by update-released-apis
 */
export async function loadReleasedApis(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new ReleasedApisError(`Released-API cache not found: ${file} (run: abap-policy-lint update-released-apis)`);
  }
  try {
    return indexCatalogue(JSON.parse(text));
  } catch (err) {
    if (err instanceof ReleasedApisError) throw err;
    throw new ReleasedApisError(`Released-API cache is not valid JSON: ${file}`);
  }
}
