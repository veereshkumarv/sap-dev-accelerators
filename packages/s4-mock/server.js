/**
 * What: CAP server bootstrap of the S/4HANA mock: registers fault injection on all OData paths, the
 *     /mock/events/emit endpoint and /mock/health, and applies the configured page size.
 * Why: Fault injection must run before CAP's protocol adapters (including the V2 adapter) so every
 *     consumer path - V2 and V4 - can be disturbed on demand.
 * If missing or unlinked: The mock serves only happy-path data: no faults, no events, default paging.
 */
const cds = require('@sap/cds');
const express = require('express');
const { emitEvent } = require('./src/events');
const { faultMiddleware, parseRules } = require('./src/faults');

// prependListener: run before the OData V2 adapter plugin, so faults hit V2 paths in S/4 format.
cds.prependListener('bootstrap', (app) => {
  const options = cds.env.s4mock ?? {};
  app.use(faultMiddleware({ rules: parseRules(options.faults ?? process.env.S4MOCK_FAULTS), maxDelayMs: options.maxDelayMs ?? 30_000 }));

  app.get('/mock/health', (_req, res) => res.json({ status: 'UP', webhook: Boolean(options.webhook) }));

  app.post('/mock/events/emit', express.json(), async (req, res) => {
    const { type, data = {}, duplicate = false, webhook = options.webhook } = req.body ?? {};
    if (!webhook) return res.status(400).json({ error: 'No webhook: set S4MOCK_WEBHOOK_URL or pass "webhook" in the body' });
    try {
      const result = await emitEvent(webhook, type, data, { duplicate });
      return res.json({ delivered: result.statuses, event: result.event });
    } catch (err) {
      return res.status(502).json({ error: /** @type {Error} */ (err).message });
    }
  });
});

cds.on('loaded', () => {
  const pageSize = Number(cds.env.s4mock?.pageSize);
  if (pageSize > 0) cds.env.query = { ...cds.env.query, limit: { ...cds.env.query?.limit, default: pageSize, max: Math.max(pageSize, 1000) } };
});

module.exports = cds.server;
