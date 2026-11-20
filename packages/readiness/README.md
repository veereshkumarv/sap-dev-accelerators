<!--
What: User documentation of sapdx-readiness (Tool 5): the Red/Amber/Green decision rule, every
    RDY-* check, evidence folder conventions, evidence.yaml, CLI usage, CI/CD integration for CAP
    and RAP, policy configuration and limits.
Why: Release managers, developers and change boards must know exactly which evidence a release
    needs per target and why a decision is Red or Amber, without reading the code.
If missing or unlinked: Teams cannot prepare evidence correctly; readiness results look arbitrary
    and the gate is bypassed instead of fixed.
-->

# sapdx-readiness

Turns the evidence a pipeline already produces - findings, test results, coverage, audits, secret
scans, API diffs and a short release manifest - into one **Red / Amber / Green** deployment
decision for a target (DEV, QA, PROD). It works the same for CAP (Cloud Foundry, MTA) and RAP
(abapGit / transports).

```
evidence/                        sapdx-readiness check            DECISION: GREEN  -> exit 0
  cap-policy.sarif   ─┐          --evidence evidence              DECISION: AMBER  -> exit 3
  junit.xml           ├────────► --target PROD          ───────►  DECISION: RED    -> exit 1
  lcov.info           │          (policy/readiness.yaml,
  evidence.yaml ...  ─┘           policy/rules.yaml)
```

## Decision rule

Results are **never averaged**: fifty passing checks do not outweigh one failed critical check.

| Decision | When |
|----------|------|
| 🔴 **RED** | a check failed whose severity is Blocker or Critical; a check that is **mandatory** for the target has no evidence; an evidence file cannot be read |
| 🟠 **AMBER** | a check passed with a warning (e.g. coverage between minimum and target, skipped tests, moderate vulnerabilities, new Major findings); a Major/Minor check failed (rollback plan empty, change record malformed) |
| 🟢 **GREEN** | everything else |

Checks that are not mandatory for a target are still evaluated **when evidence exists** - a
destructive DB change without plan is Red on DEV too - and are reported as `skipped` when there
is no evidence.

## Checks

Severities come from [`policy/rules.yaml`](../../policy/rules.yaml); mandatory sets and thresholds
from [`policy/readiness.yaml`](../../policy/readiness.yaml).

| Check | Severity | Mandatory | Evidence | Fails when | Warns when |
|-------|----------|-----------|----------|------------|------------|
| `RDY-FINDINGS` | Critical | DEV QA PROD | any `*.sarif` (cap-policy-lint, abap-policy-lint, odata-diff, sapdx-gate, CodeQL ...) | a new, non-exempted Blocker/Critical finding (central policy + optional `--baseline`) | new Major findings |
| `RDY-TESTS` | Critical | DEV QA PROD | JUnit `*.xml` | a failure or error; fewer than `minTests` executed | tests skipped |
| `RDY-CONTRACT` | Critical | PROD | JUnit `*.xml` whose path contains `contract`, `api-tests` or `newman` | as RDY-TESTS | as RDY-TESTS |
| `RDY-COVERAGE` | Critical | QA PROD | `lcov.info` or `coverage-summary.json` | line coverage < `coverage.min` | < `coverage.warn` |
| `RDY-DEPS` | Critical | QA PROD | `npm-audit.json` (any `*audit*.json`) | `vulnerabilities.fail` levels (critical, high) | `vulnerabilities.warn` levels (moderate) |
| `RDY-SECRETS` | Blocker | QA PROD | `gitleaks*.sarif` / `gitleaks*.json` (any name containing `secret` too) | any leak | - |
| `RDY-DESCRIPTOR` | Critical | QA PROD | `mta.yaml` or `.abapgit.xml` in `project` | invalid YAML, missing `_schema-version`/`ID`/`version`/modules, literal `password`/`secret`/`clientsecret`/`token`/`apikey` values, MTA version differs from release version; abapGit without language/folder | - |
| `RDY-API-COMPAT` | Critical | QA PROD | `api-diff.json` (odata-diff `--format json`) | breaking changes without a **major** bump from `previousVersion` to `version` | - |
| `RDY-DB-MIGRATION` | Critical | - | `dbMigration` in evidence.yaml | `destructive: true` without an existing, non-empty `plan` | - |
| `RDY-ROLLBACK` | Major | PROD | `rollback` in evidence.yaml | file missing or empty | - |
| `RDY-CHANGE-RECORD` | Major | QA PROD | `changeRecord` in evidence.yaml | does not match `changeRecordPattern` (`^(CHG\|CR\|RFC)[0-9]{5,}$`) | - |
| `RDY-PROD-CONFIG` | Critical | PROD | `package.json` / `.cdsrc.json` in `project` | `[production]` auth is mocked/dummy/basic or missing, SQLite in production, remote service with inline `credentials.url`. `n/a` for RAP | - |
| `RDY-TRANSPORT` | Critical | - | `transports` in evidence.yaml | a predecessor request not imported in the target system | - |

## Usage

### 1. Describe the release once: `evidence.yaml`

```sh
npx sapdx-readiness init                 # writes evidence/evidence.yaml (template with comments)
```

```yaml
version: 1.1.0              # version being released
previousVersion: 1.0.0      # version in production (proves a major bump for breaking API changes)
changeRecord: CHG0012345    # change / RFC number
rollback: rollback.md       # procedure, relative to the evidence folder
project: ..                 # project root: mta.yaml or .abapgit.xml, package.json
dbMigration:
  destructive: false        # true -> plan: migration-plan.md is required
transports:                 # ABAP deliveries only
  targetSystem: Q01
  requests:
    - id: S4DK900123
      predecessors:
        - { id: S4DK900100, importedIn: [D01, Q01] }
```

Commit `evidence.yaml` and `rollback.md`; CI writes the rest of the folder.

### 2. Collect the evidence (CAP project)

```sh
mkdir -p evidence/contract
# unit/integration tests + coverage
node --test --experimental-test-coverage --test-coverage-include="srv/**" \
  --test-reporter=junit --test-reporter-destination=evidence/junit.xml \
  --test-reporter=lcov  --test-reporter-destination=evidence/lcov.info \
  --test-reporter=spec  --test-reporter-destination=stdout "test/*.test.js"
# API contract tests generated by odata-testgen
npx odata-testgen --input . --emit node-test
node --test --test-reporter=junit --test-reporter-destination=evidence/contract/api-tests-junit.xml "test/generated/*.test.js"
# findings, API compatibility, dependencies, secrets
npx cap-policy-lint . --format sarif --out evidence/cap-policy.sarif
npx odata-diff api/api-snapshot.json . --format json --out evidence/api-diff.json
npm audit --omit=dev --json > evidence/npm-audit.json || true
gitleaks git --report-format sarif --report-path evidence/gitleaks.sarif || true
```

For a deployed service use Newman instead: `newman run odata-tests.postman_collection.json -r junit --reporter-junit-export evidence/newman/results.xml`.

### 3. Decide

```sh
npx sapdx-readiness check --evidence evidence --target QA
npx sapdx-readiness check --evidence evidence --target PROD --format markdown --out reports/readiness.md
npx sapdx-readiness check --evidence evidence --target PROD --format json --out reports/readiness.json
```

Example (the committed [`examples/evidence`](examples/evidence), produced from a real run of
`reference-apps/sales-orders`):

```
Release readiness for PROD - version 1.0.0 (CHG0012345)

PASS    RDY-FINDINGS      * No new Blocker/Critical findings; 0 finding(s), 0 new, 0 accepted by baseline.
PASS    RDY-TESTS         * 15 test(s), 0 failed, 0 error(s), 0 skipped.
PASS    RDY-CONTRACT      * 22 contract test(s), 0 failed, 0 error(s), 0 skipped.
PASS    RDY-COVERAGE      * Line coverage 95.89 % (minimum 80 %).
PASS    RDY-DEPS          * No critical/high/moderate vulnerabilities.
PASS    RDY-SECRETS       * No secrets detected.
PASS    RDY-DESCRIPTOR    * mta.yaml sales-orders 1.0.0: 2 module(s), no literal credentials.
PASS    RDY-API-COMPAT    * No API changes.
PASS    RDY-DB-MIGRATION    No destructive database changes declared.
PASS    RDY-ROLLBACK      * Rollback procedure documented in rollback.md.
PASS    RDY-CHANGE-RECORD * Change record CHG0012345.
PASS    RDY-PROD-CONFIG   * Production profile uses xsuaa authentication.
skipped RDY-TRANSPORT       evidence.yaml has no transports section (targetSystem, requests with predecessors).

* mandatory for this target

DECISION: GREEN
```

A Red result lists the reasons, e.g.:

```
Reasons:
  - RDY-COVERAGE failed (critical): Line coverage 72.4 % is below the minimum of 80 %.
  - RDY-ROLLBACK mandatory evidence missing: evidence.yaml has no rollback entry ...

DECISION: RED
```

### Options

| Option | Meaning |
|--------|---------|
| `--evidence <dir>` | evidence folder (searched recursively, `node_modules` ignored) |
| `--target <name>` | target defined in `readiness.yaml` (case-insensitive) |
| `--format text\|json\|markdown` | output; Markdown is meant for PR comments and change records |
| `--out <file>` | write the report; a one-line summary is still printed |
| `--policy <dir>` | policy folder (default: nearest `./policy`, `SAPDX_POLICY_DIR`, bundled) |
| `--baseline <file>` | accept existing findings (`sapdx-gate ... --write-baseline baseline.json`) |
| `--today <YYYY-MM-DD>` | fixed date for exemption expiry (reproducible runs) |
| `--amber-exit <n>` | exit code for Amber (default 3; `0` lets Amber deploy) |

Exit codes: `0` GREEN, `1` RED, `3` AMBER, `2` usage or configuration error (unknown target,
missing `readiness.yaml`, invalid policy).

## CI/CD integration

GitHub Actions job before a deployment (CAP):

```yaml
readiness:
  needs: [build, test]
  runs-on: ubuntu-latest
  environment: production            # approvals stay in the platform; readiness adds evidence
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 24 }
    - uses: actions/download-artifact@v4   # junit.xml, lcov.info, *.sarif from earlier jobs
      with: { path: evidence, merge-multiple: true }
    - run: npm ci
    - run: npx --no-install sapdx-readiness check --evidence evidence --target PROD --format markdown --out readiness.md
    - if: always()
      run: cat readiness.md >> "$GITHUB_STEP_SUMMARY"
```

Amber handling is a team decision: keep the default (exit 3 fails the job) and let a release
manager re-run with `--amber-exit 0` after review, or use `--amber-exit 0` for DEV only.

**RAP / ABAP:** collect `abap-policy-lint --format sarif`, ABAP Unit results as JUnit XML (for
example from the Project "Piper" step `abapEnvironmentRunAUnitTest`), set `project` to the abapGit
repository and list the transport requests with their predecessors and the systems they are
imported in (taken from your transport management). `RDY-PROD-CONFIG` is `n/a` for ABAP.

## Programmatic use

```js
import { assess, toMarkdown } from '@sapdx/readiness';

const result = await assess({ evidenceDir: 'evidence', target: 'PROD' });
if (result.decision !== 'GREEN') console.log(toMarkdown(result));
```

## Configuring targets

Edit [`policy/readiness.yaml`](../../policy/readiness.yaml) (architect review via CODEOWNERS). It is
validated against [`readiness.schema.json`](../policy/schemas/readiness.schema.json); unknown check
ids or thresholds outside 0-100 stop the run with exit code 2. Add targets (e.g. `UAT`) with their
own mandatory list and coverage thresholds. To switch a check off everywhere, set
`enabled: false` on its rule in `rules.yaml`; to change its weight, change the severity there.

## Limits

- The checker trusts the evidence files: it verifies their content, not that the pipeline really
  produced them for this commit. Produce evidence in the same pipeline run and do not commit
  generated reports.
- Transport predecessor data must be supplied in `evidence.yaml`; there is no live connection to
  an SAP transport system or Cloud Transport Management.
- `mta.yaml` checks are structural (no `mbt` validation); run `mbt build` in the pipeline too.
- npm audit is the only dependency format read; other scanners can contribute through SARIF
  (`RDY-FINDINGS`).
