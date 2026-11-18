<!--
What: Architecture overview: layers, BTP services, security, observability and clean-core
    decisions.
Why: Records how the service fits the landscape so reviews and operations share one picture.
If missing or unlinked: Design intent is lost; reviewers and operators cannot verify the service
    against its architecture.
-->

# Architecture: sales-orders

## Building blocks

| Layer | Artefacts |
|-------|-----------|
| Domain model | `db/schema.cds` (namespace `acme.sales`) |
| Service | `srv/sales-orders-service.cds` (definition), `srv/sales-orders-service.js` (logic) |
| Runtime bootstrap | `server.js` (readiness, trace bridging) |
| Deployment | `mta.yaml` (Cloud Foundry), `xs-security.json` (XSUAA) |

## BTP services (from `mta.yaml`)

- XSUAA - authentication and role templates (`Viewer`, `Admin`)
- hana - persistence
- Destination - all calls to remote systems (S/4HANA etc.)
- Application Logging - structured JSON logs with `correlation_id`

## Clean-core principles

- S/4HANA is integrated only through **released APIs** via destinations; no direct DB access.
- No endpoints or credentials in code; the `[production]` profile uses `credentials.destination`.
- Extensions stay side-by-side on BTP; nothing is modified in the core.

## Security

- `@requires: 'authenticated-user'` on the service, `@restrict` on every entity.
- Roles are generated into `xs-security.json` from the model (`cds compile srv --to xsuaa`).
- Mocked users exist only for development/test; production uses XSUAA.

## Observability

- Liveness `/health` (CAP), readiness `/ready` (database check).
- `x-correlation-id` is accepted, generated if absent, returned and propagated to outbound calls;
  a W3C `traceparent` is mapped to it when no correlation id is sent.
- Production logs are JSON; `authorization`, `cookie` and `api-key` headers are masked by CAP.

## Decisions

Architecture decisions are recorded in `docs/adr/`.
