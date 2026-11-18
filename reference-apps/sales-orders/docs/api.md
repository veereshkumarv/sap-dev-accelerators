<!--
What: API documentation of SalesOrdersService: endpoints, roles, operations and error codes.
Why: Consumers need a stable description of the contract and its authorization model.
If missing or unlinked: Consumers reverse-engineer $metadata; role and error semantics are
    undocumented.
-->

# API: SalesOrdersService

Base path: `/odata/v4/sales-orders` (OData V4). Metadata: `/odata/v4/sales-orders/$metadata`.

## Authorization

| Role   | SalesOrders / SalesOrderItems | `cancel` |
|--------|-----------------------------|----------|
| Viewer | read                        | -        |
| Admin  | read, create, update, delete | yes     |

Anonymous requests receive **401**; authenticated users without the required role receive **403**.

## Entities

- `SalesOrders` - `ID` (UUID key), `description`*, `customer`*, `status` (read-only, default `New`),
  `netAmount`, `currency_code`, `items` (composition, deep insert supported). *mandatory
- `SalesOrderItems` - `ID`, `parent_ID`, `product`*, `quantity` (1-9999).

## Operations

`POST /SalesOrders(<ID>)/cancel` - sets `status` to `Cancelled`.

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
