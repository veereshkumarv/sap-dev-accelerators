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
 * @property {number} [pageSize]   server-driven paging size (V2 __next, V4 nextLink)
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
  // cds serve resolves to { server, url } once the server listens.
  const { server, url } = await serve([], { project: ROOT, port: options.port ?? 4005, 'in-memory?': true });
  return {
    url,
    server,
    close: () =>
      new Promise((resolve, reject) => {
        // Keep-alive client connections would otherwise keep the server (and the process) alive.
        server.closeAllConnections();
        server.close((/** @type {Error | undefined} */ err) => (err ? reject(err) : resolve()));
      }),
  };
}

module.exports = { start, ROOT };
