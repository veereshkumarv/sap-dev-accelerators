// What: Mock of the released S/4HANA API API_SALES_ORDER_SRV (subset: A_SalesOrder with deep-insert
//     items via to_Item, A_SalesOrderItem).
// Why: Lets CAP apps create and read sales orders without a shared S/4 system, including the
//     business reactions they must handle (unknown sold-to party, credit block).
// If missing or unlinked: Sales order integrations cannot be developed or tested against the mock.
using { s4mock as db } from '../db/schema';

@requires: 'authenticated-user'
@path: 'API_SALES_ORDER_SRV'
service API_SALES_ORDER_SRV {
  @restrict: [ { grant: 'READ', to: 'S4Reader' }, { grant: '*', to: 'S4Writer' } ]
  entity A_SalesOrder as projection on db.SalesOrders {
    *,
    @readonly SalesOrder,
    @readonly CreationDate,
    @readonly OverallSDProcessStatus,
    @readonly TotalCreditCheckStatus,
    @readonly TotalNetAmount,
    items as to_Item
  } excluding { items };

  @restrict: [ { grant: 'READ', to: 'S4Reader' }, { grant: '*', to: 'S4Writer' } ]
  entity A_SalesOrderItem as projection on db.SalesOrderItems;
}
