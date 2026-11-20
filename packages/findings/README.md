<!--
What: Developer documentation of @sapdx/findings: the finding model, severities, fingerprints,
    SARIF conversion, baselines and the gate rule shared by every tool.
Why: Anyone writing a new checker must emit findings the same way, or merging, baselining and
    gating across tools breaks.
If missing or unlinked: New tools invent their own result formats and cannot take part in the
    central gate or the readiness decision.
-->

# @sapdx/findings

Shared library (no CLI) used by every checker in this repository.

| Concept | API |
|---------|-----|
| Severities `blocker` > `critical` > `major` > `minor`; Blocker/Critical are blocking | `SEVERITIES`, `isBlocking`, `compareSeverity` |
| Finding: `ruleId`, `severity`, `message`, `tool`, optional `location {file,line,column}`, `object`, `exemption`, `baselineable` | `createFinding` (validates, normalises paths, computes the fingerprint) |
| Fingerprint: stable over line shifts (rule + object + file + whitespace-normalised message, no line numbers), stored in SARIF `partialFingerprints["sapdx/v1"]` | `computeFingerprint` |
| SARIF 2.1.0 in and out (GitHub code scanning, any third-party SARIF) | `toSarif`, `fromSarif` |
| Baseline of accepted findings; new vs. existing vs. resolved | `createBaseline`, `parseBaseline`, `diffBaseline` |
| Gate: fails on new, non-exempted Blocker/Critical; never averages | `evaluateGate` |
| Terminal report | `formatText` |

```js
import { createFinding, toSarif, evaluateGate } from '@sapdx/findings';

const findings = [createFinding({ ruleId: 'CAP-AUTH-001', severity: 'critical', tool: 'my-tool',
  message: 'Service X has no @requires.', location: { file: 'srv/x.cds', line: 3 } })];
const { passed, blocking } = evaluateGate(findings, { baseline });
await writeFile('out.sarif', JSON.stringify(toSarif(findings, { tool: { name: 'my-tool' } })));
```

A new checker should then apply the central policy (`applyPolicy` from [`@sapdx/policy`](../policy))
before gating, and add its rule ids to `policy/rules.yaml`.
