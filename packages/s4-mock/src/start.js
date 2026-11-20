/**
 * What: Starts the S/4HANA mock programmatically (CLI and other projects' tests): applies options
 *     (port, authentication, page size, webhook, fault rules) to the CAP environment and serves the
 *     mock with an in-memory database seeded from db/data.
 * Why: Teams start the mock with one command or one function call, without cloning or configuring
 *     a CAP project.
 * If missing or unlinked: bin/s4-mock.js and the exported start() fail; the mock can only be run
 *     with raw cds commands.
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * @typedef {object} StartOptions
 * @property {number} [port]       0 = random free port (default 4005)
 * @property {boolean} [auth]      false = no authentication (all requests privileged)
 * @property {number} [pageSize]   server-driven paging size (__next / @odata.nextLink)
 * @property {string} [webhook]    URL that receives CloudEvents
 * @property {string} [faults]     JSON array of fault rules
 */

/**
 * @param {StartOptions} [options]
 * @returns {Promise<{ url: string, server: import('node:http').Server, close: () => Promise<void> }>}
 */
async function start(options = {}) {
  const cds = require('@sap/cds');
  cds.root = ROOT;
  const s4mock = {
    ...(options.pageSize ? { pageSize: options.pageSize } : {}),
    ...(options.webhook ? { webhook: options.webhook } : {}),
    ...(options.faults ? { faults: options.faults } : {}),
  };
  cds.env.s4mock = { ...cds.env.s4mock, ...s4mock };
  if (options.auth === false) cds.env.requires.auth = { kind: 'dummy' };
  const serve = require('@sap/cds/bin/serve');
  const server = await serve([], { project: ROOT, port: options.port ?? 4005, 'in-memory?': true });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://localhost:${address.port}`,
    server,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

module.exports = { start, ROOT };
