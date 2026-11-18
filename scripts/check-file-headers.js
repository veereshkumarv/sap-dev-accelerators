#!/usr/bin/env node
/**
 * What: Verifies that every project file starts with a header explaining what the
 *       file does, why it exists, and what happens if it is missing or unlinked.
 * Why:  Maintainers (and auditors) must be able to understand any file in isolation;
 *       this makes the documentation rule enforceable in CI instead of optional.
 *       Generated reference apps and RAP examples are checked too, so generators
 *       are forced to emit the header as well.
 * If missing or unlinked: `npm run lint` no longer checks headers, new files without
 *       explanation slip into the repository, and generator regressions go unnoticed.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Files that cannot carry a header, with the reason. */
const EXCEPTIONS = [
  { pattern: /(^|\/)package-lock\.json$/, reason: 'rewritten by npm on every install' },
  { pattern: /(^|\/)reference-apps\/[^/]+\/xs-security\.json$/, reason: 'XSUAA descriptor; documented in the app docs/files.md' },
  { pattern: /^packages\/rap-scaffold\/examples\/out\/.*\.xml$/, reason: 'abapGit XML metadata is regenerated on export; documented in examples/out/docs/files.md' },
];
const BINARY = /\.(png|jpe?g|gif|ico|pdf|zip|mtar|sqlite|db)$/i;
const HEADER_WINDOW_LINES = 40;
const MARKERS = [
  { name: 'What:', pattern: /\bWhat:/ },
  { name: 'Why:', pattern: /\bWhy:/ },
  { name: 'If missing ...:', pattern: /\bIf missing\b/i },
];

/**
 * Header text for a file: the "//" key (package.json) or "$comment" (JSON Schema)
 * for strict JSON, otherwise the first lines of the file.
 * @param {string} file
 * @param {string} text
 */
export function headerOf(file, text) {
  const leading = text.split('\n').slice(0, HEADER_WINDOW_LINES).join('\n');
  if (file.endsWith('.json')) {
    try {
      const doc = JSON.parse(text);
      const value = doc?.['//'] ?? doc?.$comment;
      return Array.isArray(value) ? value.join('\n') : String(value ?? '');
    } catch {
      // JSON with comments (tsconfig.json, .vscode/*.json): the header is a leading comment.
      return leading;
    }
  }
  return leading;
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {string[]} Missing marker names.
 */
export function missingMarkers(file, text) {
  const header = headerOf(file, text);
  return MARKERS.filter((m) => !m.pattern.test(header)).map((m) => m.name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXCEPTIONS.some((e) => e.pattern.test(f)) && !BINARY.test(f));

  /** @type {string[]} */
  const problems = [];
  for (const file of files) {
    let text;
    try {
      text = await readFile(path.join(root, file), 'utf8');
    } catch {
      continue; // deleted in the working tree but still in the index
    }
    const missing = missingMarkers(file, text);
    if (missing.length) problems.push(`${file}: missing ${missing.join(', ')}`);
  }
  if (problems.length) {
    console.error(`File header check failed (${problems.length} file(s)). Each file needs What / Why / If missing:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`File header check passed (${files.length} files).`);
}
