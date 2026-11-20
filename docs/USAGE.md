<!--
What: End-to-end application guide: how to bring the accelerators into a CAP or RAP project and
    use them through the delivery lifecycle (create, develop, integrate, API change, release),
    including a complete CI pipeline and brownfield adoption.
Why: The package READMEs explain each tool in depth; teams also need one path that shows which
    tool to run when, in which order, and how the outputs connect.
If missing or unlinked: Teams adopt single tools in isolation, miss the release gate or wire the
    evidence wrongly, and the accelerators deliver a fraction of their value.
-->

# Using the accelerators in a project

This guide follows a delivery from the first commit to the production release. Each step links to
the tool README with all options.

| Stage | CAP (Node.js) | RAP (ABAP Cloud) |
|-------|---------------|------------------|
| 1. Create | `create-cap-app` | `rap-scaffold` |
| 2. Develop (every commit) | `cap-policy-lint`, `npm run check` | `abap-policy-lint` |
| 3. Integrate | `s4-mock` | - |
| 4. Change the API | `odata-diff`, `odata-testgen` | `odata-diff`, `odata-testgen` (EDMX) |
| 5. Gate (every PR) | `sapdx-gate` | `sapdx-gate` |
| 6. Release | `sapdx-readiness` | `sapdx-readiness` |

## 0. Get the tools

The `@sapdx/*` packages are not published. Clone this repository once and install it with
Node.js 22 or 24:

```sh
git clone <repo-url> ~/sap-dev-accelerators && cd ~/sap-dev-accelerators && npm install
```

Then, in **your** project, add the tools you need as local packages (npm creates symlinks; the
tools resolve their own dependencies from the accelerator checkout):

```sh
npm install -D ~/sap-dev-accelerators/packages/cap-policy-lint \
               ~/sap-dev-accelerators/packages/policy \
               ~/sap-dev-accelerators/packages/odata-diff \
               ~/sap-dev-accelerators/packages/odata-testgen \
               ~/sap-dev-accelerators/packages/readiness
npx --no-install sapdx-readiness --help
```

For a team rollout publish the packages to an internal registry (e.g. Artifactory, GitHub
Packages) and install them by version. Either way, pipelines call the tools with
`npx --no-install` or `npm run`, never letting `npx` download a same-named package from the
public registry.

**Policy:** without a `policy/` folder in your repository the tools use the policy bundled with
`@sapdx/policy`. To tighten or relax it centrally, keep one governance repository with a
`policy/` folder and point the tools to it with `--policy <dir>` or `SAPDX_POLICY_DIR`. See
[packages/policy](../packages/policy/README.md).

## 1. Create

**CAP:**

```sh
npx create-cap-app sales-orders --dir ~/work --sapdx-source ~/sap-dev-accelerators
cd ~/work/sales-orders && npm run check
```

The project contains a secured service, tests (including 401/403), ESLint, a CI pipeline, an MTA
for Cloud Foundry, docs and the policy gate wired into `npm run check`. Details:
[create-cap-app](../packages/create-cap-app/README.md). The committed result is
[reference-apps/sales-orders](../reference-apps/sales-orders).

**RAP:** describe the business object in YAML and generate an abapGit repository:

```sh
npx rap-scaffold --model sales-order.yaml --out ~/work/zsd-orders
```

Tables, CDS views with access control, behavior definition and pool with ABAP Unit tests, service
definition and binding - named after `policy/naming.yaml` and verified offline with abaplint
(ABAP Cloud). Import with abapGit/gCTS in ADT. Details:
[rap-scaffold](../packages/rap-scaffold/README.md).

## 2. Develop - every commit

**CAP:** `npm run check` (lint, tests with coverage threshold, `cap-policy-lint`). The linter
explains each finding and the fix: [cap-policy-lint](../packages/cap-policy-lint/README.md).

**RAP:** download SAP's released-API list once per project (refresh with each SAP release), then
lint the abapGit repository:

```sh
npx abap-policy-lint update-released-apis --variant btp --out .sapdx/released-apis.json
npx abap-policy-lint .
```

It flags unreleased and deprecated SAP objects, modifications, non-Cloud statements, missing
authorization, SELECTs in loops, missing ABAP Unit tests and more. ATC in the system remains the
authority; this catches problems before transport. Details:
[abap-policy-lint](../packages/abap-policy-lint/README.md).

Findings you cannot fix now go into `policy/exemptions.yaml` (owner, architect approval, expiry,
backlog item) - never into code comments.

## 3. Integrate with S/4HANA (CAP)

Develop and test against a local stand-in for the S/4HANA Business Partner, Sales Order and
Product APIs, with real paths, V2/V4, S/4 response formats and fault injection:

```sh
npx s4-mock --port 4005
curl -u S4USER:mock -H "x-mock-fault: 503" \
  http://localhost:4005/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder
```

Only the `[development]` credentials of the remote service point to the mock; `[production]`
uses a destination, so no code changes between mock and real system. Details:
[s4-mock](../packages/s4-mock/README.md).

## 4. Change the API safely

At each release record the published API; in every pull request compare against it:

```sh
npx odata-diff snapshot . --out api/api-snapshot.json      # at release, commit the file
npx odata-diff api/api-snapshot.json .                     # in the PR: breaking -> exit 1
```

For RAP or deployed services use the `$metadata` EDMX files instead of a CAP folder.
Breaking changes (removed properties, narrowed types, new mandatory fields, ETags, ...) require
a new major API version. Details: [odata-diff](../packages/odata-diff/README.md).

Generate regression tests for the API from the same metadata:

```sh
npx odata-testgen --input . --emit node-test                                   # CAP, runs with cds.test
npx odata-testgen --input metadata.xml --emit postman --roles roles.yaml \
  --base-path /sap/opu/odata4/sap/zui_sd_order_o4/srvd/sap/zui_sd_order/0001   # RAP / deployed, Newman
```

Details: [odata-testgen](../packages/odata-testgen/README.md).

## 5. Gate every pull request

Every checker writes SARIF; `sapdx-gate` merges them, applies the central policy and blocks on
new Blocker/Critical findings:

```sh
npx cap-policy-lint . --format sarif --out reports/cap.sarif
npx odata-diff api/api-snapshot.json . --format sarif --out reports/api.sarif
npx sapdx-gate reports/*.sarif --baseline baseline.json
```

Upload the SARIF files to GitHub code scanning to see findings inline in the pull request.

## 6. Release

Before each deployment decide **Red / Amber / Green** from the evidence the pipeline produced:

```sh
npx sapdx-readiness init     # once: evidence/evidence.yaml (version, change record, rollback, project)
# ... the pipeline writes junit.xml, lcov.info, *.sarif, npm-audit.json, gitleaks.sarif, api-diff.json into evidence/
npx sapdx-readiness check --evidence evidence --target PROD --format markdown --out readiness.md
```

Exit `0` deploys, `1` (Red) stops, `3` (Amber) stops unless the team decides otherwise
(`--amber-exit 0`). Every reason is listed with the evidence file to fix. Details and the full
evidence list: [readiness](../packages/readiness/README.md).

## A complete CAP pipeline (GitHub Actions)

```yaml
name: delivery
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run lint
      - name: Tests with JUnit and coverage evidence
        run: |
          mkdir -p evidence/contract reports
          node --test --experimental-test-coverage --test-coverage-include="srv/**" --test-coverage-lines=80 \
            --test-reporter=spec --test-reporter-destination=stdout \
            --test-reporter=junit --test-reporter-destination=evidence/junit.xml \
            --test-reporter=lcov --test-reporter-destination=evidence/lcov.info "test/*.test.js"
      - name: Generated API contract tests
        run: |
          npx --no-install odata-testgen --input . --emit node-test
          node --test --test-reporter=junit --test-reporter-destination=evidence/contract/api-tests-junit.xml "test/generated/*.test.js"
      - name: Policy, API compatibility, dependencies
        run: |
          npx --no-install cap-policy-lint . --format sarif --out evidence/cap-policy.sarif
          npx --no-install odata-diff api/api-snapshot.json . --format json --out evidence/api-diff.json
          npm audit --omit=dev --json > evidence/npm-audit.json || true
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
      - name: Gate
        run: npx --no-install sapdx-gate evidence/*.sarif --baseline baseline.json
      - name: Release readiness
        if: github.ref == 'refs/heads/main'
        run: npx --no-install sapdx-readiness check --evidence evidence --target QA --format markdown --out readiness.md
      - if: always() && hashFiles('readiness.md') != ''
        run: cat readiness.md >> "$GITHUB_STEP_SUMMARY"
```

Notes:

- `evidence.yaml` and `rollback.md` are committed in `evidence/`; everything else is produced in
  the run (do not commit generated reports).
- The gitleaks action fails the job itself when it finds secrets; to feed `RDY-SECRETS`, run the
  gitleaks CLI with `--report-format sarif --report-path evidence/gitleaks.sarif`.
- Deploy (`mbt build` + `cf deploy`) in a following job that `needs` this one and runs only when
  readiness exited 0.

## Existing (brownfield) projects

1. Run the linters and record today's findings as a baseline:
   `npx sapdx-gate reports/*.sarif --write-baseline baseline.json` (commit it).
2. Gate with `--baseline baseline.json` in CI (`cap-policy-lint`, `abap-policy-lint`,
   `sapdx-gate`, `sapdx-readiness`): only **new** Blocker/Critical findings block.
3. Secrets, modifications of SAP objects and expired exemptions are never accepted by a baseline.
4. Reduce the baseline over time; each run reports how many findings were resolved.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `npm install` fails with `EBADENGINE` | Node 26 is not supported by SAP libraries (`@sap/xsenv`); use Node 22 or 24 (`.nvmrc`) |
| exit code 2 with "Schema validation failed" | a policy file is invalid; the message lists every problem and its path |
| `abap-policy-lint` skips ABAP-CC-001/005 | no released-API list: run `update-released-apis` |
| readiness "mandatory evidence missing" | file not found by name convention; see the evidence table in the readiness README |
| readiness RDY-DESCRIPTOR "version differs" | `version` in `evidence.yaml` and `mta.yaml` must match |
| generated contract tests cannot import `@sap/cds` | generate them inside the CAP project (default `test/generated`), not in a temp folder |
