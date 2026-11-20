/**
 * What: Builds S/4HANA business events as CloudEvents (e.g.
 *     sap.s4.beh.salesorder.v1.SalesOrder.Created.v1) and delivers them to a webhook, optionally
 *     twice to simulate duplicate delivery.
 * Why: Event consumers must be idempotent; duplicate and out-of-band delivery are hard to provoke
 *     with a real Event Mesh in development.
 * If missing or unlinked: The mock cannot emit events; event-driven integrations stay untested.
 */
const { randomUUID } = require('node:crypto');

/**
 * @param {string} type
 * @param {Record<string, unknown>} data
 * @param {{ source?: string, id?: string, time?: string }} [options]
 */
function buildEvent(type, data, { source = '/default/sap.s4.beh/s4mock', id = randomUUID(), time = new Date().toISOString() } = {}) {
  if (!/^sap\.s4\.beh\.[\w.]+\.v\d+$/.test(type)) throw new Error(`Event type "${type}" does not follow sap.s4.beh.<object>.v<n>.<Object>.<Event>.v<n>`);
  return { specversion: '1.0', type, source, id, time, datacontenttype: 'application/json', data };
}

/**
 * Delivers one CloudEvent (structured mode) once or several times with the same id.
 * @param {string} url
 * @param {ReturnType<typeof buildEvent>} event
 * @param {{ times?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<number[]>} HTTP status per delivery
 */
async function deliver(url, event, { times = 1, timeoutMs = 10_000, fetchImpl = fetch } = {}) {
  /** @type {number[]} */
  const statuses = [];
  for (let i = 0; i < times; i++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/cloudevents+json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });
    statuses.push(res.status);
  }
  return statuses;
}

/**
 * @param {string} url
 * @param {string} type
 * @param {Record<string, unknown>} data
 * @param {{ duplicate?: boolean }} [options]
 */
async function emitEvent(url, type, data, { duplicate = false } = {}) {
  const event = buildEvent(type, data);
  const statuses = await deliver(url, event, { times: duplicate ? 2 : 1 });
  return { event, statuses };
}

module.exports = { buildEvent, deliver, emitEvent };
