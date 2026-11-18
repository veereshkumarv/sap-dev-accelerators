{{!
What: Template for docs/api.md - API documentation of the generated service.
Why: Consumers get the contract, roles and error semantics in a stable document from day one.
If missing or unlinked: create-cap-app stops with "template not found"; generated projects would
    have no API documentation.
}}
# API: {{service}}

Base path: `/odata/v4/{{servicePath}}` (OData V4). Metadata: `/odata/v4/{{servicePath}}/$metadata`.

## Authorization

| Role   | {{entity}} / {{itemEntity}} | `cancel` |
|--------|-----------------------------|----------|
| Viewer | read                        | -        |
| Admin  | read, create, update, delete | yes     |

Anonymous requests receive **401**; authenticated users without the required role receive **403**.

## Entities

- `{{entity}}` - `ID` (UUID key), `description`*, `customer`*, `status` (read-only, default `New`),
  `netAmount`, `currency_code`, `items` (composition, deep insert supported). *mandatory
- `{{itemEntity}}` - `ID`, `parent_ID`, `product`*, `quantity` (1-9999).

## Operations

`POST /{{entity}}(<ID>)/cancel` - sets `status` to `Cancelled`.

| Status | Meaning |
|--------|---------|
| 200 | cancelled; returns the updated record |
| 404 | unknown ID |
| 409 | already cancelled |

## Errors

Validation errors return **400** with the OData error structure
(`error.code`, `error.message`, `error.target`), e.g. a negative `netAmount`.

## Versioning

The API version is declared in `catalog-info.yaml` (`sapdx.io/api-version`).
Breaking changes require a new major version.
