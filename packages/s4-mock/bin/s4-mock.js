#!/usr/bin/env node
/**
 * What: Executable for the s4-mock command: parses options and starts the S/4HANA mock server.
 * Why: Developers start a local S/4 stand-in with one command (npx s4-mock).
 * If missing or unlinked: The s4-mock command does not exist.
 */
const { parseArgs } = require('node:util');
const { start } = require('../src/start');

const USAGE = `Usage: s4-mock [options]

Starts a local mock of the S/4HANA APIs API_BUSINESS_PARTNER, API_SALES_ORDER_SRV and
API_PRODUCT_SRV (OData V2 at /sap/opu/odata/sap/<API>, V4 at /odata/v4/<API>).

Options:
  --port <n>          Port (default 4005)
  --no-auth           Disable authentication (default users: S4USER / READONLY, password "mock")
  --page-size <n>     Server-driven paging size
  --webhook <url>     Receive CloudEvents (e.g. SalesOrder.Created)
  --faults <json>     Fault rules, e.g. '[{"path":"A_SalesOrder","fault":"429","times":2}]'
  -h, --help

Per request: header x-mock-fault: 401|403|404|409|429|500|502|503|timeout|malformed,
header x-mock-delay-ms: <ms>.`;

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      'no-auth': { type: 'boolean' },
      'page-size': { type: 'string' },
      webhook: { type: 'string' },
      faults: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(USAGE);
  const { url } = await start({
    port: values.port ? Number(values.port) : undefined,
    auth: !values['no-auth'],
    pageSize: values['page-size'] ? Number(values['page-size']) : undefined,
    webhook: values.webhook ?? process.env.S4MOCK_WEBHOOK_URL,
    faults: values.faults ?? process.env.S4MOCK_FAULTS,
  });
  console.log(`S/4HANA mock listening on ${url}\n  V2: ${url}/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder\n  V4: ${url}/odata/v4/API_SALES_ORDER_SRV/A_SalesOrder`);
}

main().catch((err) => {
  console.error(`s4-mock: ${err.message}\n\n${USAGE}`);
  process.exitCode = 2;
});
