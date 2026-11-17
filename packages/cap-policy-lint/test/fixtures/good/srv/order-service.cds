// What: Fixture: compliant service with @requires, @restrict, a read-only projection, a bound
//     action and a function.
// Why: Negative fixture for authorization and test-coverage rules.
// If missing or unlinked: Authorization and test-coverage rules lose their negative fixture;
//     good-fixture tests fail.
using { acme.sales as sales } from '../db/schema';

@requires: 'authenticated-user'
service OrderService {
  @restrict: [
    { grant: 'READ', to: 'Viewer' },
    { grant: '*', to: 'Admin' }
  ]
  entity Orders as projection on sales.Orders actions {
    action cancel();
  };

  @readonly
  entity OrderList as projection on sales.Orders;

  function ping() returns String;
}
