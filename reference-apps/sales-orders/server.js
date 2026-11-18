/**
 * What: CAP server bootstrap: adds /ready (database readiness) and maps W3C traceparent to
 *     x-correlation-id.
 * Why: CAP provides /health (liveness) and x-correlation-id itself; readiness and trace bridging
 *     complete the operations contract.
 * If missing or unlinked: The app still starts, but /ready returns 404 (readiness probes fail) and
 *     traceparent-only callers lose log correlation.
 */
import cds from '@sap/cds';

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;

cds.on('bootstrap', (app) => {
  // Callers that only send W3C trace context still get one correlation id across logs.
  app.use((req, _res, next) => {
    const match = TRACEPARENT.exec(req.headers.traceparent ?? '');
    if (match && !req.headers['x-correlation-id']) req.headers['x-correlation-id'] = match[1];
    next();
  });

  // Readiness: only report ready when the database answers. Liveness stays on CAP's /health.
  app.get('/ready', async (_req, res) => {
    try {
      if (!cds.db) throw new Error('database not connected');
      // Bounded single-row read: portable across HANA, PostgreSQL and SQLite.
      if (!cds.env.requires.multitenancy) await cds.db.run(SELECT.one.from('acme.sales.SalesOrders').columns('ID'));
      res.json({ status: 'READY' });
    } catch (err) {
      cds.log('readiness').warn('not ready', err.message);
      res.status(503).json({ status: 'NOT_READY' });
    }
  });
});

export default cds.server;
