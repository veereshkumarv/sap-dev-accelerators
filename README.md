<!--
What: Entry point of the sap-dev-accelerators repository: purpose, status of each tool, quick
    start, repository layout, how the tools fit together, governance model and contribution rules.
Why: Anyone opening the repository (developers, architects, reviewers) needs one page that explains
    what exists, what is verified, what is still planned and how to work in the repo.
If missing or unlinked: Newcomers must reverse-engineer the monorepo from package folders; the
    status of unbuilt tools and the governance rules are easy to misread.
-->

# SAP Dev Accelerators

Custom accelerators for the development phase of SAP **RAP** (ABAP Cloud) and **CAP** (Node.js)
projects. They automate repetitive setup, enforce **clean-core** standards early, and shorten
quality feedback loops - with one central policy deciding what blocks a release.

> Guiding rule: tools generate and check **plain, conventional SAP code**. Nothing generated
> depends on these accelerators at runtime.

## Status

| # | Tool | Package | Status |
|---|------|---------|--------|
| - | Findings model, SARIF, baseline gate | [`@sapdx/findings`](packages/findings) | ✅ built, 10 tests, 100 % line coverage |
| - | Central policy engine + `sapdx-gate` | [`@sapdx/policy`](packages/policy) | ✅ built, 8 tests, 100 % line coverage |
| 1 | CAP golden-path generator | [`@sapdx/create-cap-app`](packages/create-cap-app) | ✅ built, 20 tests; generated app passes lint, 15/15 tests, policy gate and `mbt build` |
| 2 | CAP clean-core / security lint | [`@sapdx/cap-policy-lint`](packages/cap-policy-lint) | ✅ built, 12 rules, 27 tests |
| 1 | RAP generator (abapGit output) | [`@sapdx/rap-scaffold`](packages/rap-scaffold) | ✅ built, 24 tests; output verified offline with abaplint (ABAP Cloud), not yet imported into a system |
| 2 | ABAP clean-core lint (abaplint) | [`@sapdx/abap-policy-lint`](packages/abap-policy-lint) | ⏳ planned |
| 3 | OData metadata, API diff, test generator | [`sap-metadata`](packages/sap-metadata), [`odata-diff`](packages/odata-diff), [`odata-testgen`](packages/odata-testgen) | ⏳ planned |
| 4 | S/4HANA mock server | [`@sapdx/s4-mock`](packages/s4-mock) | ⏳ planned |
| 5 | Transport / deployment readiness (R/A/G) | [`@sapdx/readiness`](packages/readiness) | ⏳ planned |

Planned packages exist as skeletons (manifest and folders only). The workspace guardrail makes
`npm test` **fail** until each one has an entry point and tests - an unbuilt tool can never look
green. Tools 6-10 of the build plan (BO scaffolder, impact analysis, self-service portal,
observability kit, PR bot) are not started.

## Quick start

Requirements: **Node.js 22 or 24** for the accelerators; **Node.js 24 LTS** for generated CAP
projects (the CAP 10 HANA deployer requires it, SAP libraries reject Node 26). Git.

```sh
git clone <repo-url> sap-dev-accelerators && cd sap-dev-accelerators
npm install

# Generate a CAP project on the golden path (uses the local tool packages)
npx create-cap-app sales-orders --dir ~/work --sapdx-source .
cd ~/work/sales-orders
npm run check            # ESLint + tests (coverage >= 80 %) + CAP policy gate
cd -                     # back to the repository

# Lint any CAP project against the central policy
npx cap-policy-lint path/to/cap-project                      # text report, exit 1 on new Blocker/Critical
npx cap-policy-lint path/to/cap-project --format sarif --out cap.sarif

# Merge SARIF from several tools and decide pass/fail centrally
npx sapdx-gate cap.sarif other.sarif --baseline baseline.json

# Generate a RAP business object (abapGit format, verified with abaplint)
npx rap-scaffold --model packages/rap-scaffold/examples/sales-order.yaml --out ~/work/zsd-orders
```

Tool details: [create-cap-app](packages/create-cap-app/README.md), [rap-scaffold](packages/rap-scaffold/README.md).

## How the pieces fit

```
                 policy/ (rules, severities, exemptions, naming, forbidden objects)
                                        |
             +--------------------------+---------------------------+
             |                          |                           |
   create-cap-app (Tool 1)     cap-policy-lint (Tool 2)    other checkers (planned)
   generates compliant         CAP rules -> findings       ABAP lint, OData diff, ...
   projects                              |                           |
             |                           +------------ SARIF --------+
             v                                         |
   reference-apps/sales-orders                  sapdx-gate (central gate)
   (regenerated + checked in CI)                new Blocker/Critical -> fail
```

- **One findings format.** Every checker emits SARIF 2.1.0 through `@sapdx/findings`, so results
  merge, show up in GitHub code scanning and feed the gate.
- **One policy.** Tools propose a severity; `policy/rules.yaml` decides. Blocker/Critical findings
  fail; nothing is averaged away.
- **Baselines for brownfield code.** Existing findings can be accepted in a baseline so teams adopt
  the gates without being blocked by old debt. Secrets, modifications of SAP objects and expired
  exemptions can **never** be baselined.

## Governance

| Severity | Meaning | Gate |
|----------|---------|------|
| Blocker | modification, severe security issue, unreleased dependency | fails |
| Critical | missing authorization, unsafe update, incompatible API change | fails |
| Major | performance risk, missing tests, poor error handling | reported |
| Minor | naming, documentation, maintainability | reported |

The catalog defines 35 rules (12 CAP, 14 ABAP, 7 OData, 2 policy); CAP rules are implemented,
ABAP and OData rules are specified for the planned tools.

**Exemptions** only through [`policy/exemptions.yaml`](policy/exemptions.yaml): owner, justification
(>= 20 characters), approving architect who is not the owner, expiry within 12 months, backlog
item. An expired exemption raises `POL-EXEMPT-001` (Blocker). Suppressions written inside other
tools' configuration are ignored. Changes to `policy/` require architect review
([CODEOWNERS](.github/CODEOWNERS)).

Clean-core and engineering rules: [docs/GUARDRAILS.md](docs/GUARDRAILS.md).

## Repository layout

```
policy/                     central rule catalog, exemptions, naming, forbidden SAP objects
packages/
  findings/                 finding model, SARIF conversion, baseline gate
  policy/                   policy loader/validation (JSON Schema), exemptions, naming, sapdx-gate
  cap-policy-lint/          Tool 2 (CAP)
  create-cap-app/           Tool 1 (CAP): src/, templates/ (overlay), test/
  rap-scaffold/             Tool 1 (RAP): src/, examples/ (model + committed output), test/
  abap-policy-lint/ ...     planned tools (skeletons)
reference-apps/sales-orders committed output of create-cap-app, verified in CI
scripts/                    repo guardrails: file-header check, workspace check
docs/GUARDRAILS.md          binding clean-core and engineering rules
.github/                    CI pipeline, CODEOWNERS, PR template
```

## Working in this repository

```sh
npm run lint                        # ESLint + file-header check
npm run typecheck                   # tsc --checkJs (strict) over all sources
npm test -w packages/<name>         # one package, with its coverage threshold
npm test                            # workspace guardrail + all packages
```

> `npm test` and therefore `npm run check` currently **fail by design**: the workspace guardrail
> reports the planned packages that are not built yet. Run package tests individually until all
> tools exist.

Rules for contributions (enforced in CI where possible):

- **JavaScript (ES modules) with JSDoc types**, type-checked by `tsc` in strict mode; no Python.
- **Every file starts with a header** - *What* it does, *Why* it exists, *If missing or
  unlinked* what breaks. Checked by `scripts/check-file-headers.js`; generators must emit it too.
- Every rule has a positive and a negative fixture test; packages keep coverage thresholds
  (85 % lines, 90 % for shared libraries).
- CLIs: `--help`, exit codes `0` ok / `1` gate or check failed / `2` usage or configuration error.
- Never execute the code being analysed; parse it. Tests run offline.
- Pipelines never let `npx` fall back to the public registry for these tools (`npm run`,
  `--no-install` or explicit paths).

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint + header check, type check and tests on
Node 22 and 24; regeneration of the reference app with a diff against the committed copy, then its
own `npm run check` on Node 24; regeneration of the RAP example (with abaplint verification) and a diff
against the committed output; gitleaks secret scan and `npm audit`. The pipeline has not run on
GitHub yet - the repository is local only.

## Known limitations

- No `cf deploy` has been executed (no BTP subaccount in the build environment); the MTA archive
  build is verified.
- RAP output has not been imported into an SAP system; access controls, service definition and
  binding are not syntax-checked offline (see the rap-scaffold README).
- `create-cap-app` supports Cloud Foundry and single tenancy only; Kyma and multitenancy are
  rejected with a clear message until they can be verified.
- Placeholders to replace before rollout: the `acme` namespace / npm scope in
  [`policy/naming.yaml`](policy/naming.yaml) and the team handles in CODEOWNERS.
- `@sapdx/*` packages are not published; use `--sapdx-source <path-to-this-repo>` or publish them
  to an internal registry.
