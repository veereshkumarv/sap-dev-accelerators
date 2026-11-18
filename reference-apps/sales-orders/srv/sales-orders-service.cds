// What: Service definition SalesOrdersService: projections with @restrict role grants (Viewer
//     read, Admin all) and the bound action cancel.
// Why: Exposes the OData API secure by default; the roles here generate xs-security.json role
//     templates.
// If missing or unlinked: No OData endpoint is served, xs-security.json loses its roles, and tests
//     and the policy gate fail.
using { acme.sales as db } from '../db/schema';

@requires: 'authenticated-user'
service SalesOrdersService @(path: 'sales-orders') {

  @restrict: [
    { grant: 'READ', to: 'Viewer' },
    { grant: '*', to: 'Admin' }
  ]
  entity SalesOrders as projection on db.SalesOrders actions {
    @(requires: 'Admin')
    action cancel() returns SalesOrders;
  };

  @restrict: [
    { grant: 'READ', to: 'Viewer' },
    { grant: '*', to: 'Admin' }
  ]
  entity SalesOrderItems as projection on db.SalesOrderItems;
}
