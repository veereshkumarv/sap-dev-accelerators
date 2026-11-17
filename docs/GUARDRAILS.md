<!--
What: Binding engineering and clean-core rules for the accelerators and for all code they
    generate.
Why: Single reference for reviewers and generators: released APIs only, authorization by default,
    quality gates, exemptions.
If missing or unlinked: Reviews lose their agreed standard and generators drift from clean-core
    principles; CODEOWNERS still protect the path.
-->

# Guardrails

Binding rules for everything in this repository: the accelerators themselves and the
code they generate. Reviewers reject changes that break them.

## 1. Clean-core principles (what the tools enforce and generate)

1. **Released APIs only.** ABAP code uses only C1-released SAP objects (ABAP for Cloud
   Development language version). CAP code reaches S/4HANA only through released
   OData/SOAP/event APIs listed on the SAP Business Accelerator Hub.
2. **No modifications, no classic enhancements.** Extend through released BAdIs, RAP
   extension points, key-user extensibility or side-by-side on BTP.
3. **Read SAP data through released CDS views**, never through SAP tables
   (`policy/forbidden-objects.yaml` lists successors).
4. **Configuration, not code.** No hard-coded URLs, credentials, company codes, plants or
   sales organisations. Endpoints come from destinations/communication arrangements.
5. **Secure by default.** Every service/BO declares authorization (`@requires`/`@restrict`,
   DCL + `authorization master`). Generated projects include a negative (401/403) test.
6. **Upgrade-stable.** Generated code is plain, conventional SAP code that builds and runs
   without the generator. No hidden runtime framework.

## 2. Quality gates

| Gate | Where | Fails on |
|------|-------|----------|
| ESLint | every package, generated CAP apps | any error |
| Type check (`tsc --checkJs`, strict) | accelerator sources | any error |
| Unit tests (`node --test`) with coverage thresholds | every package | failure or coverage below threshold (85 % lines by default, 90 % for shared libraries) |
| `cap-policy-lint` / `abap-policy-lint` → `sapdx-gate` | generated apps, reference apps, consuming repos | new non-exempted Blocker/Critical |
| Secret scan (gitleaks) | CI | any finding |
| Dependency audit (`npm audit --audit-level=high`) | CI | high/critical vulnerability |
| `odata-diff` | PR on API projects | breaking change without major version bump |
| Readiness checker | before QA/PROD deployment | Red; Amber requires approval |

Severity, baselining and exemptions are governed centrally in `policy/` — tools propose a
severity, the policy catalog decides. Blocker/Critical never get averaged away.

## 3. Engineering rules for accelerator code

- Node.js >= 22, ES modules, JavaScript with JSDoc types checked by `tsc` in strict mode.
- Every tool emits findings through `@sapdx/findings` (SARIF 2.1.0) and reads rules,
  naming and exemptions through `@sapdx/policy`. No private severity scales.
- Finding messages must not contain line numbers (fingerprints must survive line moves).
- CLIs use `node:util` `parseArgs`, print `--help`, and use exit codes
  `0` success, `1` gate/check failed, `2` usage or configuration error.
- No network access at runtime unless the command's purpose is to fetch (and then it is
  explicit and has a timeout). Tests run offline.
- Deterministic output: stable ordering, no timestamps in generated files unless passed in.
- Never execute code from the project being analysed; parse it.
- Every rule has at least one positive and one negative fixture test.
- No new runtime dependency without a reason in the PR description; prefer Node built-ins.
- Scripts and tooling are written in JavaScript (Node.js); UI code uses SAPUI5. No Python.
- **Every file starts with a header** stating *What* the file does, *Why* it exists, and
  *If missing or unlinked* — what breaks when the file is absent or its reference is broken.
  Use the file type's comment syntax; strict JSON uses a `"//"` key (package.json) or
  `$comment` (JSON Schema). Generators must emit this header in every file they create.
  Enforced by `scripts/check-file-headers.js` in `npm run lint` (only exception:
  `package-lock.json`, rewritten by npm).

## 4. Exemptions

Only through `policy/exemptions.yaml`: owner, justification (>= 20 chars), approving
architect different from owner, expiry within 12 months, remediation backlog item.
Expired exemptions raise `POL-EXEMPT-001` (Blocker, cannot be baselined). In-source
suppressions from third-party tools are ignored by the gate.
