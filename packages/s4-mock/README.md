<!--
What: User documentation of the S/4HANA mock: start, consumer wiring (CAP destinations), APIs and
    seed data, business behaviour, fault injection, events, paging, use in tests and limits.
Why: Teams must be able to replace the real S/4HANA system with the mock in development and tests
    without changing code, and know exactly where the mock differs from S/4HANA.
If missing or unlinked: Teams wire the mock incorrectly (or into production), cannot use fault
    injection and over-trust mock behaviour.
-->

# s4-mock

A local, stateful stand-in for **S/4HANA Cloud APIs**, built as a CAP application. CAP and other
BTP apps develop and test their integration without a shared S/4 system, including the error
cases a real system rarely produces on demand.

| API | Entities | Paths |
|-----|----------|-------|
| `API_BUSINESS_PARTNER` | `A_BusinessPartner` (+ `to_BusinessPartnerAddress`), `A_BusinessPartnerAddress` | V2 `/sap/opu/odata/sap/API_BUSINESS_PARTNER/`, V4 `/odata/v4/API_BUSINESS_PARTNER/` |
| `API_SALES_ORDER_SRV` | `A_SalesOrder` (+ deep insert `to_Item`), `A_SalesOrderItem` | V2 `/sap/opu/odata/sap/API_SALES_ORDER_SRV/`, V4 `/odata/v4/...` |
| `API_PRODUCT_SRV` (read-only) | `A_Product` (+ `to_Description`), `A_ProductDescription` | V2 `/sap/opu/odata/sap/API_PRODUCT_SRV/`, V4 `/odata/v4/...` |

Entity and field names are those of the released S/4HANA APIs (a subset of fields). V2 responses
use the S/4 format (`d.results`, `__deferred`, `/Date(...)/`) via the CAP OData V2 adapter.

## Start

```sh
npx s4-mock                                  # http://localhost:4005
npx s4-mock --port 4010 --page-size 50       # server-driven paging
npx s4-mock --no-auth                        # no authentication
npx s4-mock --webhook http://localhost:4004/events   # receive SalesOrder.Created events
```

Requires Node.js 22 or 24. Data lives in an in-memory database and is reset on every start.

Users (basic authentication, mock only): `S4USER` / `mock` (read and write), `READONLY` / `mock`
(read only). Anonymous requests get **401**, writes by `READONLY` get **403**.

## Wire a CAP consumer to the mock

Only the destination differs between mock and real system - no code change:

```json
"cds": {
  "requires": {
    "API_SALES_ORDER_SRV": {
      "kind": "odata-v2",
      "model": "srv/external/API_SALES_ORDER_SRV",
      "[development]": {
        "credentials": { "url": "http://localhost:4005/sap/opu/odata/sap/API_SALES_ORDER_SRV", "username": "S4USER", "password": "mock" }
      },
      "[production]": {
        "credentials": { "destination": "S4HANA", "path": "/sap/opu/odata/sap/API_SALES_ORDER_SRV" }
      }
    }
  }
}
```

Import the real API metadata (`cds import API_SALES_ORDER_SRV.edmx`) for the consumer model;
the mock implements the subset of fields listed in `db/schema.cds`. The production profile uses
a destination only (enforced by `cap-policy-lint` rule `CAP-REMOTE-001`); the mock credentials
exist only in `[development]`.

For controlled tests against real BTP services use `cds bind` (hybrid testing); keep the mock for
fast, deterministic tests.

## Business behaviour

Creating `A_SalesOrder`:

- `SoldToParty` must exist in the Business Partner data -> otherwise **400** with target `SoldToParty`
- `SalesOrder` numbers are assigned (1000001, 1000002, ...), items numbered `000010`, `000020`, ...
- `CreationDate` = today, `OverallSDProcessStatus` = `A`, `TotalNetAmount` = sum of item net amounts
- **Credit block**: customer `1000009` is blocked -> `TotalCreditCheckStatus` = `B`
- `sap.s4.beh.salesorder.v1.SalesOrder.Created.v1` is sent to the webhook (if configured)

Seed data (`db/data/*.csv`, synthetic, no personal data): business partners `1000001`,
`1000002` (organisations), `1000003` (person), `1000009` (blocked); products `TG11`, `TG12`,
`MZ-FG-R100` with EN/DE descriptions; sales order `1000000`. The CSV files carry no header
comment because CAP reads every line as data.

## Fault injection

Per request (any OData path, V2 or V4):

| Header | Effect |
|--------|--------|
| `x-mock-fault: 401` / `403` / `404` / `409` / `500` / `502` / `503` | that status with an S/4-style error body (V2: `error.code`, `error.message.{lang,value}`, `innererror.transactionid`) |
| `x-mock-fault: 429` | 429 with `Retry-After: 1` |
| `x-mock-fault: timeout` | connection held, then dropped without response (`x-mock-timeout-ms`, default 30 s) |
| `x-mock-fault: malformed` | 200 with truncated JSON |
| `x-mock-delay-ms: 1500` | adds latency (max 30 s) |

For consumers that cannot set headers, configure rules (first match wins; `times` = only the
first n requests; `probability` = random share; `method` optional):

```sh
npx s4-mock --faults '[{"path":"A_SalesOrder","method":"POST","fault":"429","times":2},
                       {"path":"API_PRODUCT_SRV","fault":"503","probability":0.1}]'
# or S4MOCK_FAULTS='[...]'
```

Typical use: prove that the consumer retries after 429, surfaces 409 conflicts, fails fast on
timeouts and does not crash on malformed payloads.

## Events

```sh
curl -X POST http://localhost:4005/mock/events/emit -H 'Content-Type: application/json' -d '{
  "type": "sap.s4.beh.salesorder.v1.SalesOrder.Changed.v1",
  "data": { "SalesOrder": "1000000" },
  "duplicate": true,
  "webhook": "http://localhost:4004/events"
}'
```

Events are CloudEvents 1.0 (`application/cloudevents+json`). `duplicate: true` delivers the same
event (same `id`) twice - consumers must be idempotent.

## Use in automated tests

```js
const { start } = require('@sapdx/s4-mock');
let mock;
before(async () => { mock = await start({ port: 0, pageSize: 2 }); process.env.S4_URL = mock.url; });
after(() => mock.close());
```

Suggested test pyramid: every commit against the mock (fast, deterministic), every pull request
component and contract tests, nightly selected tests against a real S/4 QA system, release
candidates full business-process tests in QA.

## Limits

- Subset of entities and fields; no `$batch`-specific behaviour beyond what CAP provides, no
  change sets across services, no pricing or ATP logic.
- Authorization is role-based on the mock users, not S/4 communication arrangements.
- Event delivery is direct HTTP to a webhook, not SAP Event Mesh.
- `cap-policy-lint` reports Minor `CAP-NAME-001` findings for this package: the service and entity
  names deliberately mirror SAP's API names instead of the organisation's naming convention.
