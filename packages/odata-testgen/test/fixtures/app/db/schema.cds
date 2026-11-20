// What: Test fixture - persistence model for the odata-testgen end-to-end app.
// Why: Covers draft root with composition, an ETag entity, read-only and insert-only entities.
// If missing or unlinked: The fixture service cannot compile; the end-to-end test fails.
namespace fixture;

using { cuid, managed } from '@sap/cds/common';

entity Orders : cuid, managed {
  @mandatory customer : String(10);
  note                : String(40);
  quantity            : Integer;
  items               : Composition of many Items on items.order = $self;
}

entity Items : cuid {
  order   : Association to Orders;
  product : String(20);
}

entity Notes : cuid, managed {
  text  : String(80);
  count : Integer;
}

entity Products {
  key code : String(10);
      name : String(40);
}

entity Logs {
  key ID   : Integer;
      text : String(80);
}
