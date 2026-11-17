// What: Fixture: services without authorization or with @requires any, writable entities,
//     untested operations, bad service name.
// Why: Positive fixture for CAP-AUTH-001/002, CAP-TEST-001 and service naming.
// If missing or unlinked: Positive tests for authorization and test-coverage rules fail.
using { my.bookshop as db } from '../db/schema';

service AdminService {
  entity Books as projection on db.books;
}

@requires: 'any'
service public_api {
  entity Books as projection on db.books actions {
    action restock(quantity : Integer);
  };
  function stats() returns Integer;
}
