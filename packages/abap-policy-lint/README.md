<!--
What: User documentation of abap-policy-lint: what it checks, setup, daily use, CI integration,
    released-API catalogue, baseline/exemptions, the recommended in-system ATC layer and limits.
Why: The ABAP gate can block releases; teams need to know exactly what it checks, how to adopt it
    on existing code and where offline checking ends.
If missing or unlinked: Teams cannot adopt the ABAP gate correctly, misread findings, or mistake
    it for a replacement of ATC.
-->

# abap-policy-lint

Fast, **offline** clean-core gate for ABAP repositories in **abapGit / gCTS** format. It runs on a
developer laptop or in CI in seconds, before code reaches the system, and reports in the same
SARIF format and with the same central policy as all other accelerators.

It **complements** the in-system ATC run; it does not replace it (see *Two-layer model*).

## What it checks

| Rule | Severity | Detects |
|------|----------|---------|
| `ABAP-CC-001` | Blocker | Use of SAP objects that are **not released** (needs the released-API catalogue) |
| `ABAP-CC-005` | Major | Use of **deprecated** SAP APIs, with the successor |
| `ABAP-CC-002` | Blocker, never baselined | SAP objects in the repository (modifications) and **classic** enhancements (`HOOK_IMPL`); BAdI implementations are allowed |
| `ABAP-CC-003` | Critical | SAP tables listed in `policy/forbidden-objects.yaml` (in SQL or as types), with the released CDS successor |
| `ABAP-CC-004` | Critical | Forbidden function modules / classes from the same list |
| `ABAP-LANG-001` | Blocker | Statements not permitted in the language version (ABAP Cloud by default), e.g. `WRITE`, `CLIENT SPECIFIED` |
| `ABAP-SEC-001` | Critical | CDS view entities without `#CHECK`, `#CHECK` without an access control, managed/unmanaged behavior without `authorization master/dependent` |
| `ABAP-SEC-002` | Critical | Dangerous statements: native SQL, kernel/system calls, dynamic program generation |
| `ABAP-PERF-001` | Major | Database access inside loops |
| `ABAP-PERF-002` | Major | `SELECT` without `WHERE` and without `UP TO` / `SINGLE` |
| `ABAP-DB-001` | Major | `CLIENT SPECIFIED`, `USING CLIENT`, `USING ALL CLIENTS` |
| `ABAP-CFG-001` | Major | Hard-coded company code / plant / sales organisation values and URLs |
| `ABAP-TEST-001` | Major | Behavior pools without ABAP Unit test classes |
| `ABAP-SYNTAX-001` | Major (reported, not blocking) | Offline syntax/parser problems (see *Limits*) |
| `ABAP-LOG-001` | Minor | Behavior pools that never write to the application log (`CL_BALI_LOG`) |
| `ABAP-NAME-001` | Minor | Behavior pools not following `policy/naming.yaml` |
| `ABAP-LINT-*` | Minor | Curated abaplint rules: unused variables/types, obsolete statements, `NEW` instead of `CREATE OBJECT`, `xsdbool`, strict SQL, escaped host variables, empty statements |

Severities come from `policy/rules.yaml`; architects can change them centrally.

## Setup

```sh
# inside the accelerators repository (until the packages are published to your registry)
npm install
# in your ABAP repository project, or globally:
npm install -D <path-to>/sap-dev-accelerators/packages/abap-policy-lint
```

Download SAP's released-API list once (and again after each SAP release):

```sh
npx abap-policy-lint update-released-apis --variant btp      # BTP ABAP Environment (default)
npx abap-policy-lint update-released-apis --variant public   # S/4HANA Cloud Public Edition
npx abap-policy-lint update-released-apis --variant pce      # S/4HANA Cloud Private Edition / on-premise clean core
```

This writes `.sapdx/released-apis.json` (about 0.5-3 MB) from
[SAP/abap-atc-cr-cv-s4hc](https://github.com/SAP/abap-atc-cr-cv-s4hc). Commit it so CI runs
offline and reproducibly, or download it in the pipeline. Without it, `ABAP-CC-001/005` are
**skipped with a warning**, never guessed.

## Daily use

```sh
npx abap-policy-lint                       # lint the repository in the current folder
npx abap-policy-lint path/to/abap-repo     # or a specific abapGit repository
```

Example output:

```
BLOCKER  ABAP-CC-001   src/zcl_report.clas.abap:12  Class/interface CL_SALV_TABLE is not a released SAP API (btp).
CRITICAL ABAP-CC-003   src/zcl_report.clas.abap:20  Table/view MARA is forbidden by policy; use I_Product.
MAJOR    ABAP-PERF-001 src/zcl_report.clas.abap:24  Database operation in loop

3 finding(s): 1 blocker, 1 critical, 1 major

14 objects checked (abaplint, ABAP version Cloud).
Released-API catalogue: btp (7067 objects).
GATE FAILED: 2 new Blocker/Critical finding(s)
```

Exit codes: `0` gate passed, `1` new Blocker/Critical findings, `2` usage or configuration error.

| Option | Use |
|--------|-----|
| `--released-apis <file>` | Other catalogue location (also `$SAPDX_RELEASED_APIS`) |
| `--deps <dir>` | abapGit folder(s) with customer objects your code references (data elements, classes from other repos); removes false "not found" syntax findings |
| `--abap-version v758` | On-premise / classic language version instead of ABAP Cloud |
| `--format sarif --out abap.sarif` | SARIF for code scanning and `sapdx-gate` |
| `--baseline <file>` | Accept existing findings (brownfield adoption) |
| `--policy <dir>` | Other policy folder (default: nearest `policy/` or the bundled one) |

## Adopting it on existing code

```sh
npx abap-policy-lint --format sarif --out reports/abap.sarif
npx sapdx-gate reports/abap.sarif --write-baseline .sapdx-baseline.json   # commit this file
npx abap-policy-lint --baseline .sapdx-baseline.json                      # from now on: only new issues block
```

Modifications (`ABAP-CC-002`) can never be baselined. To accept a specific finding temporarily,
add an exemption to `policy/exemptions.yaml` (owner, approving architect, expiry, backlog item).

## CI

GitHub Actions:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 24 }
- run: npm ci
- run: npx --no-install abap-policy-lint . --format sarif --out reports/abap.sarif
- run: npx --no-install sapdx-gate reports/abap.sarif --baseline .sapdx-baseline.json
  if: always()
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with: { sarif_file: reports/abap.sarif, category: abap-clean-core }
```

Azure DevOps uses the same two commands in `script:` steps; publish the SARIF with the
*SARIF SAST Scans Tab* extension.

## Two-layer model

| Layer | Tool | When | Authority |
|-------|------|------|-----------|
| Offline | `abap-policy-lint` | every commit / pull request | fast feedback, policy rules, released-API usage |
| In-system | ATC with SAP's released check variants | before transport release | **authoritative** |

Recommended ATC check variants (as published in SAP's release information):
`ABAP_CLOUD_DEVELOPMENT_DEFAULT` for ABAP Cloud development, `ABAP_CLEAN_CORE_DEVELOPMENT` for
clean-core development in S/4HANA (successor of the deprecated 3-tier variant),
`ABAP_CLEAN_CORE_READINESS` / `ABAP_CLOUD_READINESS` to assess existing code, plus `SLIN_SEC`
for security checks.

## Limits (be aware)

- **Offline syntax check** lacks the full system: references to objects outside the repository
  appear as `ABAP-SYNTAX-001` (Major, not blocking). Pass `--deps` to resolve them.
- **No parser** in abaplint for access controls (DCL), service definitions and service bindings;
  they are listed as "not syntax-checked offline" in the output.
- **abaplint grammar gaps:** `... DEFINITION DEFERRED FOR TESTING` and `CREATE OBJECT ... FOR TESTING`
  (valid ABAP Cloud) are normalised in memory before checking; implicit RAP handler parameters
  (`failed`, `reported`) produce findings abaplint cannot avoid. Both are reported as notes, never
  hidden. The workarounds are shared with `rap-scaffold` (`src/abaplint-compat.js`).
- **Reference detection** covers classes, interfaces, function modules (literal names), SQL
  sources and type references. Dynamic calls (`CALL METHOD (name)`, dynamic `SELECT FROM (tab)`)
  cannot be resolved offline.
- **Hard-coded values** are detected for common organisational field names (`bukrs`, `werks`,
  `vkorg`, ...); other domain constants are not.

## Programmatic use

```js
import { lintRepository, loadReleasedApis } from '@sapdx/abap-policy-lint';

const released = await loadReleasedApis('.sapdx/released-apis.json');
const { findings, gate, info } = await lintRepository('path/to/repo', { released });
```
