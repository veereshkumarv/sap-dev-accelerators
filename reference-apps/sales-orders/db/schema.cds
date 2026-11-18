// What: Domain model: SalesOrders with composition of SalesOrderItems, using cuid/managed aspects
//     from @sap/cds/common.
// Why: Persistence model shared by all services; namespace and names follow policy/naming.yaml so
//     CAP-NAME-001 passes.
// If missing or unlinked: The service projection on acme.sales.SalesOrders fails to compile and
//     the app cannot start or deploy its database.
namespace acme.sales;

using {
  cuid,
  managed,
  Currency
} from '@sap/cds/common';

entity SalesOrders : cuid, managed {
  description : String(255) @mandatory;
  customer    : String(10)  @mandatory;
  status      : String(20) default 'New' @readonly;
  netAmount   : Decimal(15, 2) default 0;
  currency    : Currency;
  items       : Composition of many SalesOrderItems
                  on items.parent = $self;
}

entity SalesOrderItems : cuid {
  parent   : Association to SalesOrders;
  product  : String(40) @mandatory;
  quantity : Integer default 1 @assert.range: [1, 9999];
}
