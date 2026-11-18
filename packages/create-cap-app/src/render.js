/**
 * What: Minimal template renderer: replaces {{name}} placeholders with values and fails on
 *     unknown or unused-but-required placeholders.
 * Why: Overlay templates need simple substitution only; a tiny renderer avoids a template-engine
 *     dependency and can never execute code embedded in templates (no eval).
 * If missing or unlinked: The generator cannot render any overlay file and create-cap-app stops
 *     before writing the project.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;
/** Template comments ({{! ... }}) document the template itself and are removed when rendering. */
const TEMPLATE_COMMENT = /\{\{![\s\S]*?\}\}\n?/g;

export class RenderError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'RenderError';
  }
}

/**
 * @param {string} template
 * @param {Record<string, string>} values
 * @param {string} [source] Template name for error messages.
 */
export function render(template, values, source = 'template') {
  /** @type {Set<string>} */
  const unknown = new Set();
  const out = template.replace(TEMPLATE_COMMENT, '').replace(PLACEHOLDER, (_m, name) => {
    if (!Object.hasOwn(values, name)) {
      unknown.add(name);
      return '';
    }
    return values[name];
  });
  if (unknown.size) throw new RenderError(`${source}: unknown placeholder(s) ${[...unknown].sort().join(', ')}`);
  return out;
}
