{{!
What: Template for test/operations.test.js - tests for /health, /ready and correlation-id
    propagation.
Why: Probes and log correlation are part of the production contract and must not regress
    silently.
If missing or unlinked: create-cap-app stops with "template not found"; generated projects would
    ship untested probes and correlation.
}}
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import cds from '@sap/cds';

const { GET } = cds.test(`${import.meta.dirname}/..`);

describe('operations contract', () => {
  it('serves liveness on /health', async () => {
    const { status, data } = await GET('/health');
    assert.equal(status, 200);
    assert.equal(data.status, 'UP');
  });

  it('serves readiness on /ready once the database answers', async () => {
    const { status, data } = await GET('/ready');
    assert.equal(status, 200);
    assert.equal(data.status, 'READY');
  });

  // Correlation applies to service requests (CAP's request context), not to the probes.
  const SERVICE = '/odata/v4/{{servicePath}}/{{entity}}?$top=1';
  const viewer = { username: 'bob', password: '' };

  it('echoes an incoming x-correlation-id', async () => {
    const { headers } = await GET(SERVICE, { auth: viewer, headers: { 'x-correlation-id': 'test-corr-1' } });
    assert.equal(headers['x-correlation-id'], 'test-corr-1');
  });

  it('generates a correlation id when none is sent', async () => {
    const { headers } = await GET(SERVICE, { auth: viewer });
    assert.match(headers['x-correlation-id'], /^[\w-]{8,}$/);
  });

  it('derives the correlation id from a W3C traceparent', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const { headers } = await GET(SERVICE, { auth: viewer, headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` } });
    assert.equal(headers['x-correlation-id'], traceId);
  });
});
