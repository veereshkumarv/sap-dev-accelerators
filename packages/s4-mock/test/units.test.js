/**
 * What: Unit tests for the S/4HANA mock helpers (fault rules, fault selection, error bodies, event
 *     building and delivery) and for the programmatic start() with paging, rule-based faults and
 *     disabled authentication.
 * Why: Fault rules and events are configured by consuming teams; misparsed rules or wrong event
 *     envelopes would make their tests meaningless.
 * If missing or unlinked: Helper regressions (e.g. rules never firing) go unnoticed.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildEvent, deliver, errorBody, parseRules, pickFault, start } = require('../index');

const req = (url, headers = {}, method = 'GET') => ({ url, originalUrl: url, headers, method });

describe('fault rules', () => {
  it('parses rules and validates input', () => {
    assert.deepEqual(parseRules(undefined), []);
    const [rule] = parseRules('[{"path":"A_SalesOrder","fault":"429","times":2,"method":"post"}]');
    assert.equal(rule.fault, '429');
    assert.equal(rule.method, 'POST');
    assert.ok(rule.path.test('/x/A_SalesOrder'));
    assert.throws(() => parseRules('{'), /not valid JSON/);
    assert.throws(() => parseRules('{"a":1}'), /must be a JSON array/);
    assert.throws(() => parseRules('[{"path":"x","fault":"418"}]'), /needs "path"/);
  });

  it('header wins; rules fire by path, method, times and probability', () => {
    const rules = parseRules('[{"path":"Orders","fault":"500","times":1,"method":"GET"},{"path":"Products","fault":"503","probability":0.5}]');
    assert.equal(pickFault(req('/Orders', { 'x-mock-fault': '404' }), rules), '404');
    assert.equal(pickFault(req('/Orders', { 'x-mock-fault': 'nope' }), rules), undefined);
    assert.equal(pickFault(req('/Orders', {}, 'POST'), rules), undefined, 'method filter');
    assert.equal(pickFault(req('/Orders'), rules), '500');
    assert.equal(pickFault(req('/Orders'), rules), undefined, 'times exhausted');
    assert.equal(pickFault(req('/Products'), rules, () => 0.1), '503');
    assert.equal(pickFault(req('/Products'), rules, () => 0.9), undefined);
    assert.equal(pickFault(req('/Other'), rules), undefined);
    const always = parseRules('[{"path":".","fault":"timeout"}]');
    assert.equal(pickFault(req('/any'), always), 'timeout');
  });

  it('error bodies follow the V2 or V4 OData error format', () => {
    assert.equal(errorBody(500, '/sap/opu/odata/sap/API/X').error.message.value, 'Internal server error (simulated).');
    assert.deepEqual(errorBody(404, '/odata/v4/API/X'), { error: { code: 'MOCK/404', message: 'Resource not found (simulated).' } });
  });
});

describe('events', () => {
  it('builds CloudEvents and rejects non-S/4 event types', () => {
    const e = buildEvent('sap.s4.beh.salesorder.v1.SalesOrder.Created.v1', { SalesOrder: '1' }, { id: 'x', time: 't' });
    assert.deepEqual(e, { specversion: '1.0', type: 'sap.s4.beh.salesorder.v1.SalesOrder.Created.v1', source: '/default/sap.s4.beh/s4mock', id: 'x', time: 't', datacontenttype: 'application/json', data: { SalesOrder: '1' } });
    assert.throws(() => buildEvent('order.created', {}), /does not follow/);
  });

  it('delivers the same event n times', async () => {
    /** @type {any[]} */
    const calls = [];
    const fetchImpl = /** @type {any} */ (async (url, init) => {
      calls.push([url, JSON.parse(init.body).id, init.headers['content-type']]);
      return { status: 204 };
    });
    const event = buildEvent('sap.s4.beh.product.v1.Product.Changed.v1', {});
    assert.deepEqual(await deliver('http://hook', event, { times: 3, fetchImpl }), [204, 204, 204]);
    assert.equal(new Set(calls.map((c) => c[1])).size, 1);
    assert.equal(calls[0][2], 'application/cloudevents+json');
  });
});

describe('programmatic start', () => {
  it('serves with paging, rule-based faults and no authentication', async () => {
    const mock = await start({ port: 0, auth: false, pageSize: 2, faults: '[{"path":"A_ProductDescription","fault":"503","times":1}]' });
    try {
      const v4 = await (await fetch(`${mock.url}/odata/v4/API_BUSINESS_PARTNER/A_BusinessPartner`)).json();
      assert.equal(v4.value.length, 2);
      assert.match(v4['@odata.nextLink'], /(\$|%24)skiptoken=2/);
      const v2 = await (await fetch(`${mock.url}/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner?$format=json`)).json();
      assert.match(v2.d.__next, /\$skiptoken=2/);
      assert.equal((await fetch(`${mock.url}/odata/v4/API_PRODUCT_SRV/A_ProductDescription`)).status, 503);
      assert.equal((await fetch(`${mock.url}/odata/v4/API_PRODUCT_SRV/A_ProductDescription`)).status, 200, 'rule fired once');
      assert.equal((await (await fetch(`${mock.url}/mock/health`)).json()).status, 'UP');
    } finally {
      await mock.close();
    }
  });
});
