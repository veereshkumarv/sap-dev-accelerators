<!--
What: User documentation of odata-diff: what counts as breaking, the release-snapshot workflow,
    CLI usage, CI integration, exemptions and limits.
Why: API owners must catch incompatible changes in the pull request and agree on how versions are
    bumped; the rules must be explicit to be trusted.
If missing or unlinked: Teams guess which changes break consumers and cannot adopt the check in CI.
-->

# odata-diff

Detects **breaking OData API changes** between two versions of a service - before consumers
break - and recommends the semantic-version bump.

## What is breaking

| Rule | Breaking change |
|------|-----------------|
| `ODATA-BRK-001` | service or entity set removed, or entity set no longer readable |
| `ODATA-BRK-002` | property or navigation removed |
| `ODATA-BRK-003` | type changed, `maxLength`/`precision`/`scale` narrowed, navigation target changed |
| `ODATA-BRK-004` | new mandatory property on a creatable set, property became mandatory / non-nullable |
| `ODATA-BRK-005` | operation removed, kind or return type changed, parameter removed/retyped/mandatory; draft enabled or disabled |
| `ODATA-BRK-006` | key changed |
| `ODATA-BRK-007` | create/update/delete no longer allowed, property became computed or immutable, ETag introduced |
| `ODATA-CHG-001` | additive and compatible (new sets, optional properties, widened lengths, ...) |

Breaking rules are Critical in `policy/rules.yaml` and fail the gate; additive changes are Minor.
Recommendation: any breaking change -> **major**, only additive -> **minor**, none -> **patch**.

## Usage

Inputs can be a CAP project folder, a `$metadata` EDMX file (V2/V4) or a snapshot JSON.

```sh
# 1. At each release: record the published API (commit the file)
npx odata-diff snapshot . --out api/api-snapshot.json

# 2. In every pull request: compare the released API with the current state
npx odata-diff api/api-snapshot.json .
```

Example:

```
CRITICAL ODATA-BRK-004  SalesOrdersService/SalesOrders/region  New mandatory property region; existing create requests do not send it.
CRITICAL ODATA-BRK-003  SalesOrdersService/SalesOrders/note    Value range narrowed (maxLength 40 -> 20).
MINOR    ODATA-CHG-001  SalesOrdersService/SalesOrders/remark  Optional property remark was added.

BREAKING: 2 breaking change(s) - consumers break; release only as a new major API version.
GATE FAILED: 2 breaking change(s) not exempted
```

| Option | Use |
|--------|-----|
| `--format json --out reports/api-diff.json` | machine report (`recommendation`, counts, findings) - read by the readiness checker |
| `--format sarif --out reports/api-diff.sarif` | code scanning / `sapdx-gate` |
| `--policy <dir>`, `--today <date>` | other policy folder, exemption expiry date |

Exit codes: `0` compatible, `1` breaking changes not exempted, `2` usage or input error.

RAP / S/4 services: download `$metadata` from the old and new system (or keep the file of the
last release) and compare the two XML files.

## Accepting a breaking change

Either publish a new major API version (new service / path) or, when all consumers are known to
be unaffected, add a time-boxed exemption in `policy/exemptions.yaml`, e.g. rule `ODATA-BRK-002`,
object `SalesOrdersService/SalesOrders/note`, with owner, approver, expiry and backlog item.

## CI (GitHub Actions)

```yaml
- run: npx --no-install odata-diff api/api-snapshot.json . --format sarif --out reports/api-diff.sarif
- run: npx --no-install odata-diff api/api-snapshot.json . --format json --out reports/api-diff.json
  if: always()
```

## Limits

Behavioural changes (different validation, changed defaults, new side effects) are not visible
in metadata; contract and regression tests (`odata-testgen`) cover those.
