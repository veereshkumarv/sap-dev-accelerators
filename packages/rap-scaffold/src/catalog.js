/**
 * What: Describes every file of a generated RAP repository (What / Why / If missing or unlinked)
 *     and formats the matching header comment for ABAP, CDS-family and Markdown files.
 * Why: Generated files must explain themselves like every file in this organisation; abapGit XML
 *     metadata is regenerated on each serialization, so it is documented in docs/files.md instead
 *     of carrying an inline comment that would be stripped.
 * If missing or unlinked: Generated objects have no headers and no files.md, and the repository
 *     header check fails for committed examples.
 */

/**
 * @typedef {object} Description
 * @property {string} what
 * @property {string} why
 * @property {string} missing
 * @property {string} [noInline]
 */

export const XML_NO_INLINE = 'abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.';

/**
 * Comment style by file name: ABAP sources use ", CDS-family sources use //, Markdown <!-- -->.
 * @param {string} file
 * @returns {'abap' | 'slash' | 'html' | 'none'}
 */
export function commentStyle(file) {
  if (file.endsWith('.abap')) return 'abap';
  if (/\.(asddls|asdcls|asbdef|srvdsrv|asddlxs)$/.test(file)) return 'slash';
  if (file.endsWith('.md')) return 'html';
  return 'none';
}

/**
 * @param {Description} d
 * @param {string} file
 * @param {string} content
 */
export function withHeader(d, file, content) {
  const style = d.noInline ? 'none' : commentStyle(file);
  if (style === 'none') return content;
  const lines = [`What: ${d.what}`, `Why: ${d.why}`, `If missing or unlinked: ${d.missing}`].flatMap((p) => wrap(p, 94));
  if (style === 'html') return `<!--\n${lines.join('\n')}\n-->\n\n${content}`;
  const mark = style === 'abap' ? '"' : '//';
  return `${lines.map((l) => `${mark} ${l}`.trimEnd()).join('\n')}\n${content}`;
}

/**
 * @param {Array<{ path: string } & Description>} files
 * @param {string} title
 */
export function renderFilesDoc(files, title) {
  const rows = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(
      (f) =>
        `## \`${f.path}\`\n\n- **What:** ${f.what}\n- **Why:** ${f.why}\n- **If missing or unlinked:** ${f.missing}\n${f.noInline ? `- **No inline header:** ${f.noInline}\n` : ''}`,
    );
  return `# Files in ${title}\n\nSource files carry this information as a header comment; abapGit XML metadata is documented here only.\n\n${rows.join('\n')}`;
}

/**
 * @param {string} text
 * @param {number} width
 */
function wrap(text, width) {
  /** @type {string[]} */
  const out = [];
  let line = '';
  for (const w of text.split(' ')) {
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
