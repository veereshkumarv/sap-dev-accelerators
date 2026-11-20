// What: Test fixture - service with draft, ETag, @restrict roles, read-only/insert-only sets and operations.
// Why: Exercises every planning branch of odata-testgen against a real CAP runtime.
// If missing or unlinked: The end-to-end test has no service to generate tests for.
using { fixture as db } from '../db/schema';

@requires: 'authenticated-user'
service FixtureService {
  @odata.draft.enabled
  @restrict: [ { grant: 'READ', to: 'Viewer' }, { grant: '*', to: 'Admin' } ]
  entity Orders as projection on db.Orders;

  @restrict: [ { grant: 'READ', to: 'Viewer' }, { grant: '*', to: 'Admin' } ]
  entity Notes as projection on db.Notes {
    *,
    modifiedAt @odata.etag
  } actions {
    action touch() returns Notes;
  };

  @readonly
  entity Products as projection on db.Products;

  @insertonly
  @restrict: [ { grant: 'CREATE', to: 'Admin' } ]
  entity Logs as projection on db.Logs;

  function ping(text : String) returns String;

  @requires: 'Admin'
  action reset() returns Boolean;
}
