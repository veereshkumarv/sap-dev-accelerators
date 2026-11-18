/**
 * What: File catalog of the generated CAP project: for every output file, What it does, Why it
 *     exists and what happens If it is missing or unlinked - plus the overlay template it comes
 *     from (if any).
 * Why: Single source for the mandatory file headers and for docs/files.md; the generator refuses
 *     to finish if a file (including files emitted by SAP's cds-dk) has no catalog entry, so headers
 *     cannot silently go missing after a cds-dk upgrade.
 * If missing or unlinked: The generator cannot add headers or write docs/files.md and stops;
 *     generated projects would fail the header check in CI.
 */

/**
 * @typedef {object} CatalogEntry
 * @property {string} path        Output path relative to the project root.
 * @property {string} what
 * @property {string} why
 * @property {string} missing
 * @property {string} [template]  Overlay template (relative to templates/); absent = produced by cds-dk or code.
 * @property {string} [noInline]  Reason why the file cannot carry an inline header.
 *
 * @param {import('./options.js').Names} n
 * @returns {CatalogEntry[]}
 */
export function fileCatalog(n) {
  return [
    // ------------------------------------------------------------ overlay templates
    {
      path: 'db/schema.cds',
      template: 'db/schema.cds',
      what: `Domain model: ${n.entity} with composition of ${n.itemEntity}, using cuid/managed aspects from @sap/cds/common.`,
      why: 'Persistence model shared by all services; namespace and names follow policy/naming.yaml so CAP-NAME-001 passes.',
      missing: `The service projection on ${n.namespace}.${n.entity} fails to compile and the app cannot start or deploy its database.`,
    },
    {
      path: `srv/${n.serviceFile}.cds`,
      template: 'srv/service.cds',
      what: `Service definition ${n.service}: projections with @restrict role grants (Viewer read, Admin all) and the bound action cancel.`,
      why: 'Exposes the OData API secure by default; the roles here generate xs-security.json role templates.',
      missing: 'No OData endpoint is served, xs-security.json loses its roles, and tests and the policy gate fail.',
    },
    {
      path: `srv/${n.serviceFile}.js`,
      template: 'srv/service.js',
      what: `Service implementation for ${n.service}: input validation and the cancel action, using bounded queries and cds.log.`,
      why: 'Business logic lives next to the service definition (CAP convention), written to pass the CAP policy rules.',
      missing: 'CAP serves generic CRUD only: validation is skipped and the cancel action returns 501 Not Implemented.',
    },
    {
      path: 'server.js',
      template: 'server.js',
      what: 'CAP server bootstrap: adds /ready (database readiness) and maps W3C traceparent to x-correlation-id.',
      why: 'CAP provides /health (liveness) and x-correlation-id itself; readiness and trace bridging complete the operations contract.',
      missing: 'The app still starts, but /ready returns 404 (readiness probes fail) and traceparent-only callers lose log correlation.',
    },
    {
      path: `test/${n.serviceFile}.test.js`,
      template: 'test/service.test.js',
      what: `API tests for ${n.service} with node:test and cds.test: reads, writes, validation, cancel action and 401/403 authorization cases.`,
      why: 'Proves the service and its authorization work; required by CAP-TEST-001/002 in the policy gate.',
      missing: 'npm test covers less, coverage drops below the threshold and the policy gate reports untested operations and missing 401/403 tests.',
    },
    {
      path: 'test/operations.test.js',
      template: 'test/operations.test.js',
      what: 'Tests for the operations contract: /health, /ready and correlation-id propagation (x-correlation-id and traceparent).',
      why: 'Platform probes and log correlation are production requirements; they must be tested like features.',
      missing: 'Regressions in probes or correlation reach production unnoticed.',
    },
    {
      path: 'catalog-info.yaml',
      template: 'catalog-info.yaml',
      what: 'Backstage catalog entry: owner, lifecycle and API version of this service.',
      why: 'Ownership and versioning are needed for impact analysis and are enforced by CAP-API-001.',
      missing: 'The service has no recorded owner or API version and the policy gate reports CAP-API-001.',
    },
    {
      path: 'README.md',
      template: 'README.md',
      what: 'Developer entry point: how to run, test and check the project and where the guardrails come from.',
      why: 'New team members get from clone to running tests without asking.',
      missing: 'Onboarding relies on tribal knowledge; commands and conventions are rediscovered by each developer.',
    },
    {
      path: 'docs/api.md',
      template: 'docs/api.md',
      what: `API documentation of ${n.service}: endpoints, roles, operations and error codes.`,
      why: 'Consumers need a stable description of the contract and its authorization model.',
      missing: 'Consumers reverse-engineer $metadata; role and error semantics are undocumented.',
    },
    {
      path: 'docs/architecture.md',
      template: 'docs/architecture.md',
      what: 'Architecture overview: layers, BTP services, security, observability and clean-core decisions.',
      why: 'Records how the service fits the landscape so reviews and operations share one picture.',
      missing: 'Design intent is lost; reviewers and operators cannot verify the service against its architecture.',
    },
    {
      path: 'docs/adr/0001-record-architecture-decisions.md',
      template: 'docs/adr/0001-record-architecture-decisions.md',
      what: 'First architecture decision record: the decision to keep ADRs, with the template to follow.',
      why: 'Architecture decisions must be traceable over time, not buried in chat or tickets.',
      missing: 'There is no agreed place or format for decisions; later ADRs are inconsistent or never written.',
    },
    {
      path: 'docs/files.md',
      what: 'Catalog of every generated file with What / Why / If missing - including files that cannot carry an inline header.',
      why: 'One place to understand the project layout, and the documentation for strict-JSON files such as xs-security.json.',
      missing: 'Files without inline headers (xs-security.json) lose their documentation; the overview of the project disappears.',
    },
    {
      path: '.github/workflows/ci.yml',
      template: '.github/workflows/ci.yml',
      what: 'CI pipeline: lint, tests with coverage, CAP policy gate, secret scan, dependency audit and MTA build.',
      why: 'Every push is checked against the same guardrails before it can reach DEV.',
      missing: 'Nothing runs on push or pull request; policy violations, leaked secrets and broken builds can be merged.',
    },
    {
      path: '.npmrc',
      template: '.npmrc',
      what: 'npm settings: exact versions on install and enforced Node engine.',
      why: 'Reproducible dependency trees and no installs on unsupported Node versions.',
      missing: 'npm saves caret ranges (silent upgrades) and installs on unsupported Node versions.',
    },

    // ------------------------------------------------------------ produced by cds-dk, extended by the generator
    {
      path: 'package.json',
      what: `npm manifest of ${n.npmName}: CAP dependencies, scripts (start, test, lint, policy, check) and cds configuration (mocked users, XSUAA in production).`,
      why: 'Created by cds init and extended with the organisation scripts and policy tooling.',
      missing: 'Nothing installs or starts; cds configuration (auth, db, destinations) is lost.',
    },
    {
      path: 'mta.yaml',
      what: 'Multi-target application descriptor for Cloud Foundry: srv module, database deployer and BTP service instances (XSUAA, HANA/Postgres, destination, logging).',
      why: 'Created by cds add mta/hana/xsuaa/destination/application-logging so deployment stays aligned with SAP tooling.',
      missing: 'mbt build and cf deploy fail; service bindings are not created.',
    },
    {
      path: 'xs-security.json',
      noInline: 'XSUAA validates the descriptor strictly; an extra comment key could break service creation.',
      what: 'XSUAA security descriptor: scopes and role templates generated from the @restrict roles in the service model.',
      why: 'Roles used in the model must exist in XSUAA so they can be assigned to users via role collections.',
      missing: 'The XSUAA instance in mta.yaml cannot be created; users cannot be granted Viewer/Admin and every request is forbidden.',
    },
    {
      path: 'eslint.config.mjs',
      what: 'ESLint configuration from cds init: CAP recommended rules plus @sap/eslint-plugin-cds model checks.',
      why: 'Catches JavaScript and CDS modelling mistakes before the policy gate and tests run.',
      missing: 'npm run lint fails with "no configuration found" and code-quality checks stop.',
    },
    {
      path: '.gitignore',
      what: 'Files Git must not track: node_modules, gen/, MTA archives, local credentials (default-env.json, .cdsrc-private.json), SQLite files, reports.',
      why: 'Prevents committing secrets and build output.',
      missing: 'Credentials and build artefacts can be committed; the secret scan in CI then fails.',
    },
    {
      path: '.vscode/extensions.json',
      what: 'Recommended VS Code extensions for CAP development.',
      why: 'Gives every developer the same CDS language support and tooling.',
      missing: 'No extension recommendations; developers may work without CDS language support.',
    },
    {
      path: '.vscode/launch.json',
      what: 'VS Code debug configurations for running and debugging the CAP server.',
      why: 'One-click debugging with the correct cds entry point.',
      missing: 'Debugging must be configured by hand.',
    },
    {
      path: '.vscode/settings.json',
      what: 'Workspace settings for VS Code in this project.',
      why: 'Shared editor behaviour for the team.',
      missing: 'Editors fall back to personal settings.',
    },
    {
      path: '.vscode/tasks.json',
      what: 'VS Code tasks (for example cds watch) used by the debug configurations.',
      why: 'launch.json refers to these tasks.',
      missing: 'Debug configurations that depend on these tasks fail to start.',
    },
  ];
}
