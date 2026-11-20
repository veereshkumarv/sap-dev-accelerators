<!--
What: Documentation of sap-metadata: inputs, the normalised service model and its known limits.
Why: odata-diff and odata-testgen users need to know what the model contains and where V2/V4
    metadata lose information.
If missing or unlinked: Developers extending the OData tools misread the model; V2 limitations
    are rediscovered the hard way.
-->

# sap-metadata

Library that turns OData metadata into one small, version-independent **service model**. It is
used by [`odata-diff`](../odata-diff) and [`odata-testgen`](../odata-testgen).

## Inputs

| Input | How it is read |
|-------|----------------|
| `$metadata` EDMX, OData **V4** (CAP, RAP) | SAP's `@sap-ux/edmx-parser` + `annotation-converter` |
| `$metadata` EDMX, OData **V2** (classic S/4HANA APIs) | same parser; `sap:creatable/updatable/deletable` become capabilities |
| **CAP project folder** | every service compiled to V4 EDMX with the project's own CDS compiler (no project code executed) |
| **Snapshot JSON** | a model written earlier by `odata-diff snapshot` |

```js
import { loadServiceModel } from '@sapdx/sap-metadata';
const model = await loadServiceModel('path/to/cap-project-or-metadata.xml');
```

## Model

Per service: entity sets with keys, properties (`type`, `nullable`, `maxLength`, `precision`,
`scale`, `computed`, `immutable`, `mandatory`, `foreignKey`), navigations, capabilities
(`readable`, `insertable`, `updatable`, `deletable`), `draft`, `etag`, and operations (action /
function, bound / unbound, parameters, return type). Draft plumbing (`IsActiveEntity`,
`DraftAdministrativeData`, `draftEdit` ...) is removed so it never appears as an API change or a
test target. Output is sorted, so the same input always gives the same model.

## Known limits

- **V2:** function imports are reported as `action` (the converter does not expose the HTTP
  method), and `ConcurrencyMode="Fixed"` ETags are not detected.
- **Mandatory** means `Common.FieldControl: #Mandatory` (CAP `@mandatory`) or non-nullable
  non-key properties; server-side validations in handler code are not visible in metadata.
