/**
 * What: Fault injection for the S/4HANA mock: chooses a fault per request (header x-mock-fault or
 *     configured rules), adds latency (x-mock-delay-ms) and answers with S/4-style error responses,
 *     429 + Retry-After, connection timeouts or malformed JSON.
 * Why: Integration code must prove it handles authentication failures, throttling, conflicts,
 *     outages, slow and broken responses - conditions a shared test system rarely produces on
 *     demand.
 * If missing or unlinked: The mock only returns happy-path responses; error handling of consumers
 *     stays untested.
 */
const { randomUUID } = require('node:crypto');

const STATUS_FAULTS = {
  400: 'Bad request (simulated).',
  401: 'Unauthorized (simulated).',
  403: 'No authorization for this operation (simulated).',
  404: 'Resource not found (simulated).',
  409: 'Resource was changed in the meantime (simulated).',
  429: 'Too many requests (simulated).',
  500: 'Internal server error (simulated).',
  502: 'Bad gateway (simulated).',
  503: 'Service temporarily unavailable (simulated).',
};
const FAULTS = new Set([...Object.keys(STATUS_FAULTS), 'timeout', 'malformed']);
const ODATA_PATH = /^\/(sap\/opu\/odata\/|odata\/v4\/)/;

/**
 * @typedef {{ path: RegExp, fault: string, method?: string, times?: number, probability?: number }} FaultRule
 */

/**
 * Parses fault rules (JSON array), e.g. S4MOCK_FAULTS='[{"path":"A_SalesOrder","fault":"429","times":2}]'.
 * @param {string | undefined} json
 * @returns {FaultRule[]}
 */
function parseRules(json) {
  if (!json) return [];
  let list;
  try {
    list = JSON.parse(json);
  } catch {
    throw new Error('S4MOCK_FAULTS is not valid JSON (expected an array of rules)');
  }
  if (!Array.isArray(list)) throw new Error('S4MOCK_FAULTS must be a JSON array');
  return list.map((r, i) => {
    if (!r || typeof r.path !== 'string' || !FAULTS.has(String(r.fault))) {
      throw new Error(`S4MOCK_FAULTS[${i}]: needs "path" (regex) and "fault" (${[...FAULTS].join(', ')})`);
    }
    return {
      path: new RegExp(r.path),
      fault: String(r.fault),
      ...(r.method ? { method: String(r.method).toUpperCase() } : {}),
      ...(Number.isInteger(r.times) ? { times: r.times } : {}),
      ...(typeof r.probability === 'number' ? { probability: r.probability } : {}),
    };
  });
}

/**
 * Fault for a request: the header wins, then the first matching rule with budget left.
 * @param {{ headers: Record<string, any>, method: string, originalUrl?: string, url: string }} req
 * @param {FaultRule[]} rules  (times is decremented in place)
 * @param {() => number} random
 */
function pickFault(req, rules, random = Math.random) {
  const header = req.headers['x-mock-fault'];
  if (header !== undefined) return FAULTS.has(String(header)) ? String(header) : undefined;
  const url = req.originalUrl ?? req.url;
  for (const rule of rules) {
    if (!rule.path.test(url) || (rule.method && rule.method !== req.method)) continue;
    if (rule.times !== undefined) {
      if (rule.times <= 0) continue;
      rule.times -= 1;
      return rule.fault;
    }
    if (rule.probability === undefined || random() < rule.probability) return rule.fault;
  }
  return undefined;
}

/**
 * S/4-style error body: OData V2 shape for /sap/opu/odata paths, V4 shape otherwise.
 * @param {number} status
 * @param {string} url
 */
function errorBody(status, url) {
  const message = /** @type {Record<string, string>} */ (STATUS_FAULTS)[status];
  if (url.startsWith('/sap/opu/odata/')) {
    return {
      error: {
        code: `MOCK/${status}`,
        message: { lang: 'en', value: message },
        innererror: { transactionid: randomUUID().replaceAll('-', '').toUpperCase(), timestamp: new Date().toISOString() },
      },
    };
  }
  return { error: { code: `MOCK/${status}`, message } };
}

/**
 * Express middleware. Only OData paths are affected; /mock/* admin endpoints never are.
 * @param {{ rules?: FaultRule[], random?: () => number, maxDelayMs?: number, timeoutMs?: number }} [options]
 */
function faultMiddleware({ rules = [], random = Math.random, maxDelayMs = 30_000, timeoutMs = 30_000 } = {}) {
  return async (/** @type {any} */ req, /** @type {any} */ res, /** @type {() => void} */ next) => {
    const url = req.originalUrl ?? req.url;
    if (!ODATA_PATH.test(url)) return next();
    const delay = Math.min(Number(req.headers['x-mock-delay-ms']) || 0, maxDelayMs);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const fault = pickFault(req, rules, random);
    if (!fault) return next();
    res.set('x-mock-fault-applied', fault);
    if (fault === 'timeout') {
      // Hold the connection, then drop it without a response (client sees a socket error/timeout).
      setTimeout(() => req.socket.destroy(), Math.min(Number(req.headers['x-mock-timeout-ms']) || timeoutMs, maxDelayMs));
      return undefined;
    }
    if (fault === 'malformed') {
      return res.status(200).type('application/json').send('{"d":{"results":[{"SalesOrder":"10');
    }
    const status = Number(fault);
    if (status === 429) res.set('Retry-After', '1');
    if (status === 401) res.set('WWW-Authenticate', 'Basic realm="SAP NetWeaver Application Server [MOCK]"');
    return res.status(status).json(errorBody(status, url));
  };
}

module.exports = { FAULTS, parseRules, pickFault, errorBody, faultMiddleware };
