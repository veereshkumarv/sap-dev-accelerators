/**
 * What: Formats and inserts the mandatory What / Why / If-missing header into a file, choosing
 *     the comment syntax from the file type, and renders docs/files.md from the catalog.
 * Why: Every generated file must explain itself; one implementation guarantees consistent headers
 *     across templates and SAP-generated files.
 * If missing or unlinked: Generated files have no headers, docs/files.md is not written, and the
 *     generated project fails the header check in CI.
 */

/** @typedef {import('./catalog.js').CatalogEntry} CatalogEntry */

const WIDTH = 100;

/**
 * @param {string} file
 * @returns {'block' | 'slash' | 'hash' | 'html' | 'json-key' | 'none'}
 */
export function commentStyle(file) {
  const base = file.split('/').pop() ?? file;
  if (/\.(c|m)?js$|\.ts$/.test(base)) return 'block';
  if (base.endsWith('.cds')) return 'slash';
  if (file.startsWith('.vscode/') && base.endsWith('.json')) return 'slash';
  if (base === 'package.json') return 'json-key';
  if (/\.ya?ml$/.test(base) || ['.gitignore', '.npmrc', '.env', 'CODEOWNERS'].includes(base) || base.endsWith('.properties')) return 'hash';
  if (base.endsWith('.md')) return 'html';
  return 'none';
}

/**
 * @param {CatalogEntry} entry
 * @returns {string[]} Wrapped lines without comment markers.
 */
export function headerLines(entry) {
  return [`What: ${entry.what}`, `Why: ${entry.why}`, `If missing or unlinked: ${entry.missing}`].flatMap((p) => wrap(p, WIDTH - 4));
}

/**
 * Returns the content with the header inserted. Hashbang lines stay first.
 * @param {CatalogEntry} entry
 * @param {string} content
 */
export function withHeader(entry, content) {
  const style = entry.noInline ? 'none' : commentStyle(entry.path);
  if (style === 'none') return content;
  if (style === 'json-key') {
    const doc = JSON.parse(content);
    delete doc['//'];
    const lines = [`What: ${entry.what}`, `Why: ${entry.why}`, `If missing or unlinked: ${entry.missing}`];
    return `${JSON.stringify({ '//': lines, ...doc }, null, 2)}\n`;
  }
  const lines = headerLines(entry);
  const header =
    style === 'block'
      ? `/**\n${lines.map((l) => ` * ${l}`.trimEnd()).join('\n')}\n */\n`
      : style === 'slash'
        ? `${lines.map((l) => `// ${l}`.trimEnd()).join('\n')}\n`
        : style === 'hash'
          ? `${lines.map((l) => `# ${l}`.trimEnd()).join('\n')}\n`
          : `<!--\n${lines.join('\n')}\n-->\n`;
  const separator = style === 'hash' || style === 'html' ? '\n' : '';
  if (content.startsWith('#!')) {
    const nl = content.indexOf('\n') + 1;
    return `${content.slice(0, nl)}${header}${separator}${content.slice(nl)}`;
  }
  return `${header}${separator}${content}`;
}

/**
 * @param {CatalogEntry[]} entries
 * @param {string} projectName
 */
export function renderFilesDoc(entries, projectName) {
  const rows = [...entries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(
      (e) =>
        `## \`${e.path}\`\n\n- **What:** ${e.what}\n- **Why:** ${e.why}\n- **If missing or unlinked:** ${e.missing}\n${
          e.noInline ? `- **No inline header:** ${e.noInline}\n` : ''
        }`,
    );
  return `# Files in ${projectName}\n\nEvery file below also carries this information as a header comment, except where noted.\n\n${rows.join('\n')}`;
}

/**
 * @param {string} text
 * @param {number} width
 */
function wrap(text, width) {
  const words = text.split(' ');
  /** @type {string[]} */
  const out = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = `    ${w}`;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  out.push(line);
  return out;
}
