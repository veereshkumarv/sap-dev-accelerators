/**
 * What: API tests for SalesOrdersService with node:test and cds.test: reads, writes, validation,
 *     cancel action and 401/403 authorization cases.
 * Why: Proves the service and its authorization work; required by CAP-TEST-001/002 in the policy
 *     gate.
 * If missing or unlinked: npm test covers less, coverage drops below the threshold and the policy
 *     gate reports untested operations and missing 401/403 tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import cds from '@sap/cds';

const { GET, POST, PATCH } = cds.test(`${import.meta.dirname}/..`);

const BASE = '/odata/v4/sales-orders';
const admin = { auth: { username: 'alice', password: '' } };
const viewer = { auth: { username: 'bob', password: '' } };

/** HTTP status of a request, whether it succeeded or failed. */
async function status(request) {
  try {
    return (await request).status;
  } catch (err) {
    return err.status ?? err.response?.status;
  }
}

async function create(data = {}) {
  const { data: created } = await POST(
    `${BASE}/SalesOrders`,
    { description: 'Test order', customer: 'C001', netAmount: 100, ...data },
    admin,
  );
  return created;
}

describe('SalesOrdersService authorization', () => {
  it('rejects anonymous requests with 401', async () => {
    assert.equal(await status(GET(`${BASE}/SalesOrders`)), 401);
  });

  it('allows a Viewer to read', async () => {
    assert.equal(await status(GET(`${BASE}/SalesOrders`, viewer)), 200);
  });

  it('forbids a Viewer to create with 403', async () => {
    assert.equal(await status(POST(`${BASE}/SalesOrders`, { description: 'x', customer: 'C001' }, viewer)), 403);
  });

  it('forbids a Viewer to cancel with 403', async () => {
    const { ID } = await create();
    assert.equal(await status(POST(`${BASE}/SalesOrders(${ID})/cancel`, {}, viewer)), 403);
  });
});

describe('SalesOrdersService behaviour', () => {
  it('creates with items and reads them back', async () => {
    const created = await create({ items: [{ product: 'P-100', quantity: 2 }] });
    const { data } = await GET(`${BASE}/SalesOrders(${created.ID})?$expand=items`, admin);
    assert.equal(data.status, 'New');
    assert.equal(data.items.length, 1);
  });

  it('rejects a negative net amount with 400', async () => {
    assert.equal(await status(create({ netAmount: -1 })), 400);
  });

  it('rejects a missing mandatory field with 400', async () => {
    assert.equal(await status(POST(`${BASE}/SalesOrders`, { description: 'no customer' }, admin)), 400);
  });

  it('updates an existing record', async () => {
    const { ID } = await create();
    await PATCH(`${BASE}/SalesOrders(${ID})`, { netAmount: 250 }, admin);
    const { data } = await GET(`${BASE}/SalesOrders(${ID})`, admin);
    assert.equal(Number(data.netAmount), 250);
  });

  it('cancel sets the status and is not repeatable', async () => {
    const { ID } = await create();
    const { data } = await POST(`${BASE}/SalesOrders(${ID})/cancel`, {}, admin);
    assert.equal(data.status, 'Cancelled');
    assert.equal(await status(POST(`${BASE}/SalesOrders(${ID})/cancel`, {}, admin)), 409);
  });

  it('cancel on an unknown key returns 404', async () => {
    assert.equal(await status(POST(`${BASE}/SalesOrders(${cds.utils.uuid()})/cancel`, {}, admin)), 404);
  });
});
