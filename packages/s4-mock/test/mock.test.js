/**
 * What: In-process tests of the S/4HANA mock with cds.test: V2/V4 reads, authorization, sales order
 *     business behaviour (numbering, totals, credit block, validation), every fault type on V2 and
 *     V4 paths, latency, timeouts and event emission (including duplicate delivery).
 * Why: Teams rely on the mock behaving like S/4HANA; each behaviour they build error handling for
 *     must be proven.
 * If missing or unlinked: The package fails the workspace guardrail and mock regressions break
 *     consumers' integration tests silently.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const cds = require('@sap/cds');
const { ROOT } = require('../index');

const test = cds.test(ROOT);
const S4USER = { username: 'S4USER', password: 'mock' };
const V2 = '/sap/opu/odata/sap';
const V4 = '/odata/v4';

/** Raw fetch against the running mock (headers and status fully visible). */
async function call(path, { method = 'GET', user = S4USER, headers = {}, body } = {}) {
  const auth = user ? { authorization: `Basic ${Buffer.from(`${user.username}:${user.password}`).toString('base64')}` } : {};
  const res = await fetch(`${test.url}${path}`, {
    method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

const order = (extra = {}) => ({
  SalesOrganization: '1010',
  DistributionChannel: '10',
  OrganizationDivision: '00',
  SoldToParty: '1000001',
  TransactionCurrency: 'EUR',
  to_Item: [
    { Material: 'TG11', RequestedQuantity: 2, RequestedQuantityUnit: 'PC', NetAmount: 100 },
    { Material: 'TG12', RequestedQuantity: 1, RequestedQuantityUnit: 'PC', NetAmount: 40 },
  ],
  ...extra,
});

describe('reads and authorization', () => {
  it('serves OData V2 on the S/4 path with d.results', async () => {
    const res = await call(`${V2}/API_BUSINESS_PARTNER/A_BusinessPartner?$top=2&$format=json`);
    assert.equal(res.status, 200);
    assert.equal(res.json.d.results.length, 2);
    assert.ok(res.json.d.results[0].to_BusinessPartnerAddress.__deferred);
  });

  it('serves OData V4 with $expand on the same data', async () => {
    const res = await call(`${V4}/API_PRODUCT_SRV/A_Product('TG11')?$expand=to_Description`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.to_Description.map((d) => d.Language).sort(), ['DE', 'EN']);
  });

  it('rejects anonymous requests with 401 and read-only users on writes with 403', async () => {
    assert.equal((await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { user: undefined })).status, 401);
    const readonly = { username: 'READONLY', password: 'mock' };
    assert.equal((await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { user: readonly })).status, 200);
    assert.equal((await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { method: 'POST', user: readonly, body: order() })).status, 403);
  });

  it('products are read-only', async () => {
    assert.equal((await call(`${V4}/API_PRODUCT_SRV/A_Product`, { method: 'POST', body: { Product: 'X' } })).status, 405);
  });
});

describe('sales order business behaviour', () => {
  it('creates with deep insert: numbers, item numbers, totals, status, creation date', async () => {
    const res = await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { method: 'POST', body: order() });
    assert.equal(res.status, 201);
    assert.match(res.json.SalesOrder, /^\d{7}$/);
    assert.equal(Number(res.json.TotalNetAmount), 140);
    assert.equal(res.json.OverallSDProcessStatus, 'A');
    assert.equal(res.json.TotalCreditCheckStatus, 'A');
    assert.equal(res.json.CreationDate, new Date().toISOString().slice(0, 10));
    const items = await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder('${res.json.SalesOrder}')/to_Item`);
    assert.deepEqual(items.json.value.map((i) => i.SalesOrderItem), ['000010', '000020']);
  });

  it('assigns increasing numbers', async () => {
    const a = await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { method: 'POST', body: order({ to_Item: [] }) });
    const b = await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { method: 'POST', body: order({ to_Item: [] }) });
    assert.equal(Number(b.json.SalesOrder), Number(a.json.SalesOrder) + 1);
  });

  it('sets the credit block for blocked customers', async () => {
    const res = await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { method: 'POST', body: order({ SoldToParty: '1000009' }) });
    assert.equal(res.json.TotalCreditCheckStatus, 'B');
  });

  it('rejects unknown and missing sold-to parties with 400 and a field target', async () => {
    const unknown = await call(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder`, { method: 'POST', body: { SoldToParty: '9999999' } });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.error.message.value, 'Sold-to party 9999999 does not exist.');
    assert.equal(unknown.json.error.target, 'SoldToParty');
    assert.equal((await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { method: 'POST', body: { SalesOrganization: '1010' } })).status, 400);
  });
});

describe('fault injection', () => {
  for (const status of [401, 403, 404, 409, 429, 500, 502, 503]) {
    it(`x-mock-fault: ${status} returns ${status} with an S/4-style V2 error`, async () => {
      const res = await call(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder`, { headers: { 'x-mock-fault': String(status) } });
      assert.equal(res.status, status);
      assert.equal(res.json.error.code, `MOCK/${status}`);
      assert.equal(res.json.error.message.lang, 'en');
      assert.match(res.json.error.innererror.transactionid, /^[0-9A-F]{32}$/);
      assert.equal(res.headers.get('x-mock-fault-applied'), String(status));
    });
  }

  it('V4 paths get the V4 error shape; 429 carries Retry-After; 401 carries WWW-Authenticate', async () => {
    const v4 = await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { headers: { 'x-mock-fault': '503' } });
    assert.deepEqual(v4.json, { error: { code: 'MOCK/503', message: 'Service temporarily unavailable (simulated).' } });
    assert.equal((await call(`${V2}/API_PRODUCT_SRV/A_Product`, { headers: { 'x-mock-fault': '429' } })).headers.get('retry-after'), '1');
    assert.match((await call(`${V4}/API_PRODUCT_SRV/A_Product`, { headers: { 'x-mock-fault': '401' } })).headers.get('www-authenticate'), /Basic realm/);
  });

  it('malformed returns broken JSON with status 200', async () => {
    const res = await call(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder`, { headers: { 'x-mock-fault': 'malformed' } });
    assert.equal(res.status, 200);
    assert.equal(res.json, undefined);
  });

  it('delay header slows the response; timeout drops the connection', async () => {
    const started = Date.now();
    assert.equal((await call(`${V4}/API_PRODUCT_SRV/A_Product`, { headers: { 'x-mock-delay-ms': '300' } })).status, 200);
    assert.ok(Date.now() - started >= 290);
    await assert.rejects(call(`${V4}/API_PRODUCT_SRV/A_Product`, { headers: { 'x-mock-fault': 'timeout', 'x-mock-timeout-ms': '100' } }), /fetch failed/);
  });

  it('unknown fault values and admin endpoints are not affected', async () => {
    assert.equal((await call(`${V4}/API_PRODUCT_SRV/A_Product`, { headers: { 'x-mock-fault': 'teapot' } })).status, 200);
    assert.equal((await call('/mock/health', { headers: { 'x-mock-fault': '500' } })).status, 200);
  });
});

describe('events', () => {
  /** @type {Array<{ headers: http.IncomingHttpHeaders, body: any }>} */
  const received = [];
  /** @type {http.Server} */
  let receiver;
  let webhook = '';

  before(async () => {
    receiver = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(data) });
        res.writeHead(202).end();
      });
    });
    await new Promise((resolve) => receiver.listen(0, resolve));
    webhook = `http://localhost:${receiver.address().port}/events`;
  });
  after(() => new Promise((resolve) => receiver.close(resolve)));

  it('emits a CloudEvent and delivers duplicates with the same id', async () => {
    received.length = 0;
    const res = await call('/mock/events/emit', {
      method: 'POST',
      body: { type: 'sap.s4.beh.salesorder.v1.SalesOrder.Changed.v1', data: { SalesOrder: '1000000' }, duplicate: true, webhook },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.delivered, [202, 202]);
    assert.equal(received.length, 2);
    assert.equal(received[0].body.id, received[1].body.id);
    assert.equal(received[0].body.specversion, '1.0');
    assert.equal(received[0].headers['content-type'], 'application/cloudevents+json');
  });

  it('emits SalesOrder.Created automatically when a webhook is configured', async () => {
    received.length = 0;
    cds.env.s4mock.webhook = webhook;
    try {
      const res = await call(`${V4}/API_SALES_ORDER_SRV/A_SalesOrder`, { method: 'POST', body: order({ to_Item: [] }) });
      assert.equal(received.length, 1);
      assert.equal(received[0].body.type, 'sap.s4.beh.salesorder.v1.SalesOrder.Created.v1');
      assert.equal(received[0].body.data.SalesOrder, res.json.SalesOrder);
    } finally {
      delete cds.env.s4mock.webhook;
    }
  });

  it('rejects emission without webhook (400) and invalid event types (502)', async () => {
    assert.equal((await call('/mock/events/emit', { method: 'POST', body: { type: 'x' } })).status, 400);
    assert.equal((await call('/mock/events/emit', { method: 'POST', body: { type: 'not.sap', webhook } })).status, 502);
  });
});
