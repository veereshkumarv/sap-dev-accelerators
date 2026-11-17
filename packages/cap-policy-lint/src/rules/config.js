/**
 * What: Configuration rules: CAP-REMOTE-001 (destinations for remote services) and CAP-SEC-001
 *     (secrets in code/config).
 * Why: Credentials must come from bindings/destinations; committed secrets are blocker findings
 *     that can never be baselined.
 * If missing or unlinked: Inline credentials and committed secrets are no longer detected by the
 *     CAP gate.
 */
import YAML from 'yaml';
import { isStaticLiteral, keyName, lineOf, walk } from '../js.js';

/**
 * @typedef {import('../lint.js').RuleContext} RuleContext
 */

const REMOTE_KINDS = new Set(['odata', 'odata-v2', 'odata-v4', 'rest', 'hcql']);
const SECRET_KEY = /^(pass(word)?|passwd|pwd|secret|client_?secret|clientsecret|api_?key|apikey|access_?token|auth_?token|token|private_?key|privatekey)$/i;
const PLACEHOLDER = /^(\$\{.*\}|<.*>|\{\{.*\}\}|env:.*|process\.env.*|changeme|x+|\*+)$/i;
const TEXT_FILE = /\.(c|m)?js$|\.json$|\.ya?ml$|\.env$|\.properties$|\.cds$|\.xml$|\.txt$|(^|\/)\.cdsrc(-private)?\.json$/;
const SKIP_FILE = /(^|\/)package-lock\.json$|(^|\/)npm-shrinkwrap\.json$/;
const TEST_DIR = /(^|\/)(test|tests|__tests__)\//;
const RAW_SECRETS = [
  { name: 'private key', pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: 'JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
];

/**
 * CAP-REMOTE-001: remote services must use a destination in production; inline
 * url/user/password is only acceptable in development/test profiles.
 * @param {RuleContext} ctx
 */
export function checkRemoteServices({ project, report }) {
  for (const [source, requires] of /** @type {Array<[string, any]>} */ ([
    ['package.json', project.pkg.cds?.requires],
    ['.cdsrc.json', project.cdsrc?.requires],
  ])) {
    for (const [name, entry] of Object.entries(requires ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (!entry || typeof entry !== 'object' || !REMOTE_KINDS.has(entry.kind)) continue;
      const prod = entry['[production]']?.credentials ?? entry.credentials;
      const where = { object: `cds.requires.${name}`, location: { file: source } };
      if (!prod) {
        report('CAP-REMOTE-001', `Remote service ${name} has no production credentials; set credentials.destination under [production].`, where);
      } else if (!prod.destination) {
        report('CAP-REMOTE-001', `Remote service ${name} uses inline credentials in production; use credentials.destination.`, where);
      }
    }
  }
}

/**
 * CAP-SEC-001: secrets in source and configuration.
 *  - JSON/YAML: secret-like keys with literal values, except CAP mocked users
 *    (paths containing "auth" and "users") which are development fixtures.
 *  - JavaScript outside test folders: secret-like keys/variables with literal values.
 *  - Any text file: private keys, JWTs, AWS keys.
 * @param {RuleContext} ctx
 */
export async function checkSecrets({ project, report }) {
  for (const file of project.files) {
    if (!TEXT_FILE.test(file) || SKIP_FILE.test(file)) continue;
    const text = await project.read(file);
    if (text.length > 1_000_000) continue;

    for (const { name, pattern } of RAW_SECRETS) {
      const match = pattern.exec(text);
      if (match) {
        report('CAP-SEC-001', `Possible ${name} committed in source.`, {
          object: `${file}#${name}`,
          location: { file, line: lineAt(text, match.index) },
        });
      }
    }

    if (/\.json$/.test(file)) {
      let doc;
      try {
        doc = JSON.parse(text);
      } catch {
        continue;
      }
      scanStructured(doc, file, report);
    } else if (/\.ya?ml$/.test(file)) {
      let docs;
      try {
        docs = YAML.parseAllDocuments(text).map((d) => d.toJS());
      } catch {
        continue;
      }
      docs.forEach((d) => scanStructured(d, file, report));
    }
  }

  for (const { file, ast } of await project.jsFiles('')) {
    if (TEST_DIR.test(file)) continue;
    walk(ast, (node) => {
      /** @type {[string | undefined, any] | undefined} */
      let pair;
      if (node.type === 'Property') pair = [keyName(node.key), node.value];
      else if (node.type === 'VariableDeclarator') pair = [node.id?.name, node.init];
      else if (node.type === 'AssignmentExpression') pair = [keyName(node.left.property ?? node.left), node.right];
      if (!pair) return;
      const [key, value] = pair;
      const name = key ? normaliseKey(key) : undefined;
      if (!name || !SECRET_KEY.test(name) || !isStaticLiteral(value)) return;
      const literal = String(value.type === 'Literal' ? value.value : value.quasis[0].value.cooked);
      if (literal.length < 4 || PLACEHOLDER.test(literal) || literal.includes('-----BEGIN')) return;
      report('CAP-SEC-001', `Hard-coded secret in "${key}"; use service bindings, destinations or the credential store.`, {
        object: `${file}#${key}`,
        location: { file, ...(lineOf(node) ? { line: lineOf(node) } : {}) },
      });
    });
  }
}

/**
 * camelCase / snake / kebab names reduced to the token that matters:
 * "clientSecret" -> "clientsecret", "S4_PASSWORD" -> "password".
 * @param {string} key
 */
function normaliseKey(key) {
  const flat = key.replace(/[-\s]/g, '_').toLowerCase();
  const tail = flat.split('_').filter(Boolean);
  if (SECRET_KEY.test(flat.replaceAll('_', ''))) return flat.replaceAll('_', '');
  return tail.at(-1) ?? flat;
}

/**
 * @param {any} doc
 * @param {string} file
 * @param {RuleContext['report']} report
 * @param {string[]} [trail]
 */
function scanStructured(doc, file, report, trail = []) {
  if (Array.isArray(doc)) {
    doc.forEach((v, i) => scanStructured(v, file, report, [...trail, String(i)]));
    return;
  }
  if (!doc || typeof doc !== 'object') return;
  for (const [key, value] of Object.entries(doc)) {
    const here = [...trail, key];
    if (value && typeof value === 'object') {
      scanStructured(value, file, report, here);
      continue;
    }
    if (typeof value !== 'string' || !SECRET_KEY.test(normaliseKey(key))) continue;
    if (value.length < 4 || PLACEHOLDER.test(value)) continue;
    const lower = here.map((s) => s.toLowerCase());
    if (lower.includes('auth') && lower.includes('users')) continue; // CAP mocked users
    report('CAP-SEC-001', `Hard-coded secret at ${here.join('.')}; use service bindings, destinations or the credential store.`, {
      object: `${file}#${here.join('.')}`,
      location: { file },
    });
  }
}

/**
 * @param {string} text
 * @param {number} index
 */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
