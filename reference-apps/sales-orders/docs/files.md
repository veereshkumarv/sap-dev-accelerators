<!--
What: Catalog of every generated file with What / Why / If missing - including files that cannot
    carry an inline header.
Why: One place to understand the project layout, and the documentation for strict-JSON files
    such as xs-security.json.
If missing or unlinked: Files without inline headers (xs-security.json) lose their
    documentation; the overview of the project disappears.
-->

# Files in sales-orders

Every file below also carries this information as a header comment, except where noted.

## `.github/workflows/ci.yml`

- **What:** CI pipeline: lint, tests with coverage, CAP policy gate, secret scan, dependency audit and MTA build.
- **Why:** Every push is checked against the same guardrails before it can reach DEV.
- **If missing or unlinked:** Nothing runs on push or pull request; policy violations, leaked secrets and broken builds can be merged.

## `.gitignore`

- **What:** Files Git must not track: node_modules, gen/, MTA archives, local credentials (default-env.json, .cdsrc-private.json), SQLite files, reports.
- **Why:** Prevents committing secrets and build output.
- **If missing or unlinked:** Credentials and build artefacts can be committed; the secret scan in CI then fails.

## `.npmrc`

- **What:** npm settings: exact versions on install and enforced Node engine.
- **Why:** Reproducible dependency trees and no installs on unsupported Node versions.
- **If missing or unlinked:** npm saves caret ranges (silent upgrades) and installs on unsupported Node versions.

## `.vscode/extensions.json`

- **What:** Recommended VS Code extensions for CAP development.
- **Why:** Gives every developer the same CDS language support and tooling.
- **If missing or unlinked:** No extension recommendations; developers may work without CDS language support.

## `.vscode/launch.json`

- **What:** VS Code debug configurations for running and debugging the CAP server.
- **Why:** One-click debugging with the correct cds entry point.
- **If missing or unlinked:** Debugging must be configured by hand.

## `.vscode/settings.json`

- **What:** Workspace settings for VS Code in this project.
- **Why:** Shared editor behaviour for the team.
- **If missing or unlinked:** Editors fall back to personal settings.

## `.vscode/tasks.json`

- **What:** VS Code tasks (for example cds watch) used by the debug configurations.
- **Why:** launch.json refers to these tasks.
- **If missing or unlinked:** Debug configurations that depend on these tasks fail to start.

## `catalog-info.yaml`

- **What:** Backstage catalog entry: owner, lifecycle and API version of this service.
- **Why:** Ownership and versioning are needed for impact analysis and are enforced by CAP-API-001.
- **If missing or unlinked:** The service has no recorded owner or API version and the policy gate reports CAP-API-001.

## `db/schema.cds`

- **What:** Domain model: SalesOrders with composition of SalesOrderItems, using cuid/managed aspects from @sap/cds/common.
- **Why:** Persistence model shared by all services; namespace and names follow policy/naming.yaml so CAP-NAME-001 passes.
- **If missing or unlinked:** The service projection on acme.sales.SalesOrders fails to compile and the app cannot start or deploy its database.

## `docs/adr/0001-record-architecture-decisions.md`

- **What:** First architecture decision record: the decision to keep ADRs, with the template to follow.
- **Why:** Architecture decisions must be traceable over time, not buried in chat or tickets.
- **If missing or unlinked:** There is no agreed place or format for decisions; later ADRs are inconsistent or never written.

## `docs/api.md`

- **What:** API documentation of SalesOrdersService: endpoints, roles, operations and error codes.
- **Why:** Consumers need a stable description of the contract and its authorization model.
- **If missing or unlinked:** Consumers reverse-engineer $metadata; role and error semantics are undocumented.

## `docs/architecture.md`

- **What:** Architecture overview: layers, BTP services, security, observability and clean-core decisions.
- **Why:** Records how the service fits the landscape so reviews and operations share one picture.
- **If missing or unlinked:** Design intent is lost; reviewers and operators cannot verify the service against its architecture.

## `docs/files.md`

- **What:** Catalog of every generated file with What / Why / If missing - including files that cannot carry an inline header.
- **Why:** One place to understand the project layout, and the documentation for strict-JSON files such as xs-security.json.
- **If missing or unlinked:** Files without inline headers (xs-security.json) lose their documentation; the overview of the project disappears.

## `eslint.config.mjs`

- **What:** ESLint configuration from cds init: CAP recommended rules plus @sap/eslint-plugin-cds model checks.
- **Why:** Catches JavaScript and CDS modelling mistakes before the policy gate and tests run.
- **If missing or unlinked:** npm run lint fails with "no configuration found" and code-quality checks stop.

## `mta.yaml`

- **What:** Multi-target application descriptor for Cloud Foundry: srv module, database deployer and BTP service instances (XSUAA, HANA/Postgres, destination, logging).
- **Why:** Created by cds add mta/hana/xsuaa/destination/application-logging so deployment stays aligned with SAP tooling.
- **If missing or unlinked:** mbt build and cf deploy fail; service bindings are not created.

## `package.json`

- **What:** npm manifest of @acme/sales-orders: CAP dependencies, scripts (start, test, lint, policy, check) and cds configuration (mocked users, XSUAA in production).
- **Why:** Created by cds init and extended with the organisation scripts and policy tooling.
- **If missing or unlinked:** Nothing installs or starts; cds configuration (auth, db, destinations) is lost.

## `README.md`

- **What:** Developer entry point: how to run, test and check the project and where the guardrails come from.
- **Why:** New team members get from clone to running tests without asking.
- **If missing or unlinked:** Onboarding relies on tribal knowledge; commands and conventions are rediscovered by each developer.

## `server.js`

- **What:** CAP server bootstrap: adds /ready (database readiness) and maps W3C traceparent to x-correlation-id.
- **Why:** CAP provides /health (liveness) and x-correlation-id itself; readiness and trace bridging complete the operations contract.
- **If missing or unlinked:** The app still starts, but /ready returns 404 (readiness probes fail) and traceparent-only callers lose log correlation.

## `srv/sales-orders-service.cds`

- **What:** Service definition SalesOrdersService: projections with @restrict role grants (Viewer read, Admin all) and the bound action cancel.
- **Why:** Exposes the OData API secure by default; the roles here generate xs-security.json role templates.
- **If missing or unlinked:** No OData endpoint is served, xs-security.json loses its roles, and tests and the policy gate fail.

## `srv/sales-orders-service.js`

- **What:** Service implementation for SalesOrdersService: input validation and the cancel action, using bounded queries and cds.log.
- **Why:** Business logic lives next to the service definition (CAP convention), written to pass the CAP policy rules.
- **If missing or unlinked:** CAP serves generic CRUD only: validation is skipped and the cancel action returns 501 Not Implemented.

## `test/operations.test.js`

- **What:** Tests for the operations contract: /health, /ready and correlation-id propagation (x-correlation-id and traceparent).
- **Why:** Platform probes and log correlation are production requirements; they must be tested like features.
- **If missing or unlinked:** Regressions in probes or correlation reach production unnoticed.

## `test/sales-orders-service.test.js`

- **What:** API tests for SalesOrdersService with node:test and cds.test: reads, writes, validation, cancel action and 401/403 authorization cases.
- **Why:** Proves the service and its authorization work; required by CAP-TEST-001/002 in the policy gate.
- **If missing or unlinked:** npm test covers less, coverage drops below the threshold and the policy gate reports untested operations and missing 401/403 tests.

## `xs-security.json`

- **What:** XSUAA security descriptor: scopes and role templates generated from the @restrict roles in the service model.
- **Why:** Roles used in the model must exist in XSUAA so they can be assigned to users via role collections.
- **If missing or unlinked:** The XSUAA instance in mta.yaml cannot be created; users cannot be granted Viewer/Admin and every request is forbidden.
- **No inline header:** XSUAA validates the descriptor strictly; an extra comment key could break service creation.
