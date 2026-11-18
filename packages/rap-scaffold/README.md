<!--
What: User and maintainer documentation of rap-scaffold: model format, generated objects,
    verification approach and its limits, import steps and design decisions.
Why: Teams must know what the generator guarantees, what was verified offline and what can only
    be verified in an SAP system before importing generated objects.
If missing or unlinked: Users over-trust or under-use the generator; the honest list of offline
    verification gaps is lost.
-->

# rap-scaffold

Generates a **clean-core RAP business object** (ABAP for Cloud Development) from a small YAML
model, in **abapGit format**. You review the output as a pull request and pull it into the system
with abapGit or gCTS (Eclipse ADT). Nothing is created in a system by this tool.

```sh
npx rap-scaffold --model examples/sales-order.yaml --out ../zsd-orders
npx rap-scaffold --model model.yaml --out out --deps ../existing-abapgit-repo   # resolve existing data elements
```

Exit codes: `0` generated, `1` abaplint verification failed (nothing written), `2` usage, model or
overwrite error.

## Model

See [`examples/sales-order.yaml`](examples/sales-order.yaml). Root entity plus optional child
entities (composition), draft on by default.

| Key | Meaning |
|-----|---------|
| `area`, `package`, `description` | 2-4 letter application area (used in names), target package, text |
| `authorizationObject` | **Required.** Customer authorization object with field `ACTVT` |
| `root` / `children[]` | `name` (upper case), optional `alias`, `label`, `fields[]` |
| field | `name`, `type` (`char`, `numc`, `int4`, `dec`, `curr`, `cuky`, `dats`, `tims`) with `length`/`decimals`, or `dataElement`; `mandatory`, `readonly`, `label`, `currency` (for `curr`), `sample` (ABAP literal, required for mandatory data-element fields) |

Object names come from `policy/naming.yaml` (e.g. `ZSD_ORDER`, `ZR_SD_ORDER`, `ZC_SD_ORDER`,
`ZBP_R_SD_ORDER`, `ZUI_SD_ORDER_O4`); ABAP length limits are enforced before generation.

## Generated objects (per business object)

- Active and draft **tables** (UUID keys, administrative fields, draft include)
- **CDS view entities** (`R_` base, `C_` projection) with `@AccessControl.authorizationCheck: #CHECK`
- **Access controls**: base views require `pfcg_auth(<object>, ACTVT = '03')`, projections inherit
- **Behavior definitions**: managed, `strict ( 2 )`, draft, ETags, locks, `authorization master ( global )`
- **Behavior pool**: global authorization via `AUTHORITY-CHECK`, mandatory-field validations
- **ABAP Unit tests**: positive and negative case per validated entity (CDS test double framework)
- **Metadata extensions** (Fiori elements UI), **service definition**, **OData V4 UI binding** (unpublished)
- `README.md` and `docs/files.md`; every source file carries a *What / Why / If missing* header

The code patterns follow SAP's RAP reference scenario (`abap-platform-refscen-flight`,
branch `ABAP-platform-cloud`), including its unit-test structure, and the abapGit XML formats
are taken from it.

## Verification (offline, abaplint 2.120, ABAP Cloud)

| Object | Offline check |
|--------|---------------|
| ABAP classes (handler, tests) | parser + syntax check |
| CDS views, metadata extensions | CDS parser |
| Behavior definitions | BDEF parser (explicit check - abaplint does not report BDEF parse failures itself) |
| Tables | XML / type resolution |
| Access controls, service definition, service binding | **not checked offline** (no abaplint parser) - reported in the output, checked on activation |

Mutation tests prove the verifier catches broken CDS, behavior definitions (base and projection),
ABAP, metadata extensions and unknown types.

Transparent workarounds, all reported in the CLI output:

- **Grammar gaps:** `CLASS ... DEFINITION DEFERRED FOR TESTING` and `CREATE OBJECT ... FOR TESTING`
  (valid ABAP Cloud, used by SAP's reference) are not modelled by abaplint; the verifier checks
  an in-memory copy with the plain form. Generated files are unchanged.
- **Known gaps:** abaplint does not model the implicit `failed` / `reported` parameters of RAP
  handler methods; these findings are listed as known gaps, not hidden.
- **Stub:** a minimal `CL_ABAP_BEHAVIOR_HANDLER` (SAP-delivered) so handler classes resolve.

## Import

1. Create authorization object `<authorizationObject>` with field `ACTVT` (ADT) and assign it via
   a business role.
2. abapGit: link the output folder to the package, pull, mass-activate.
3. Publish the service binding in ADT; run ABAP Unit on the behavior pool and ATC.

## Not verified here

No SAP system was available: activation, ABAP Unit execution, service publishing and the
Fiori preview have **not** been run. Treat the first import into a sandbox as the acceptance test
and feed any activation error back into the generator tests.
