<!--
What: User documentation of @sapdx/policy: the policy folder (rules, exemptions, naming, forbidden
    objects, readiness), how it is found and validated, the sapdx-gate command and baselines.
Why: Architects own the policy and pipelines run the gate; both need one place that explains how
    severities, exemptions and baselines decide pass/fail.
If missing or unlinked: Policy changes are made blindly, exemptions are misused and teams cannot
    set up the central gate.
-->

# @sapdx/policy and sapdx-gate

The governance core: loads and validates the central policy, applies it to findings from any tool
and provides **`sapdx-gate`**, the single pass/fail decision over all SARIF reports.

## The policy folder

| File | Content | Required |
|------|---------|----------|
| [`rules.yaml`](../../policy/rules.yaml) | every rule id with severity, owning tool, `baselineable`, `enabled` | yes |
| [`exemptions.yaml`](../../policy/exemptions.yaml) | time-boxed, approved exceptions | no |
| [`naming.yaml`](../../policy/naming.yaml) | CAP name patterns, RAP object name templates | no |
| [`forbidden-objects.yaml`](../../policy/forbidden-objects.yaml) | SAP tables/function modules with released successors | no |
| [`readiness.yaml`](../../policy/readiness.yaml) | release-readiness targets and thresholds | for `sapdx-readiness` |

Each file is validated against a JSON Schema in [`schemas/`](schemas); all problems are listed at
once and the tool stops with exit code 2. Extra checks: duplicate ids, exemptions for unknown
rules, approver equal to owner, exemptions longer than 12 months.

**Where the policy comes from** (first match): `--policy <dir>`, environment variable
`SAPDX_POLICY_DIR`, the nearest `policy/rules.yaml` walking up from the current folder, the copy
bundled into the package at `npm pack` time.

**Rules of the game**

- Tools propose a severity; `rules.yaml` decides. Changing it requires architect review (CODEOWNERS).
- `enabled: false` switches a rule off everywhere.
- `baselineable: false` findings block even if they existed before (secrets, SAP modifications,
  expired exemptions).
- Wildcard ids (`ABAP-LINT-*`) give whole families one severity.

## sapdx-gate

```sh
npx sapdx-gate cap.sarif abap.sarif api.sarif               # merge, apply policy, decide
npx sapdx-gate *.sarif --baseline baseline.json             # only new findings block
npx sapdx-gate *.sarif --write-baseline baseline.json       # record current findings (no gating)
npx sapdx-gate *.sarif --out merged.sarif                   # policy-applied SARIF for upload
```

Accepts SARIF 2.1.0 from any tool (also gitleaks, CodeQL); third-party rule ids are namespaced
(`EXT-GITLEAKS-GENERIC_API_KEY`). In-tool suppressions are **discarded** - only
`exemptions.yaml` counts.

Output ends with, for example:

```
New: 3, accepted by baseline: 41, resolved since baseline: 5.
GATE FAILED: 1 new Blocker/Critical finding(s) must be fixed or formally exempted.
```

Exit codes: `0` passed, `1` new non-exempted Blocker/Critical finding, `2` usage or configuration error.

## Exemptions

```yaml
exemptions:
  - id: EXM-0001
    rule: ABAP-CC-001
    object: CLAS ZCL_SALES_HELPER      # and/or path: "srv/legacy/**"
    owner: jane.doe
    approver: john.architect           # must differ from owner
    justification: No released successor for BAPI_X until release 2508.
    created: 2026-11-01
    expires: 2027-03-31                # max. 12 months after created
    backlog: JIRA-1234
```

An expired exemption raises `POL-EXEMPT-001` (Blocker, cannot be baselined). `cap-policy-lint`
and `abap-policy-lint` report exemptions for their rules that no longer match anything as
`POL-EXEMPT-002` (Minor), so the register stays clean.

## Programmatic use

```js
import { loadPolicy, resolvePolicyDir, applyPolicy } from '@sapdx/policy';

const policy = await loadPolicy(await resolvePolicyDir());
const { findings, expired } = applyPolicy(rawFindings, policy, { today: '2026-11-20' });
```

`renderRapNames` and `isValidCapName` expose the naming conventions to generators and linters.
