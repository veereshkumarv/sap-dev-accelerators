// What: Test fixture - CAP service with draft, ETag, read-only, insert-only entities and operations.
// Why: Covers every capability and annotation sap-metadata normalises from CAP-generated V4 EDMX.
// If missing or unlinked: CAP-project and V4 normalisation tests lose their input and fail.
service Demo {
  @odata.draft.enabled
  entity Orders {
    key ID         : UUID;
        @mandatory
        customer   : String(10);
        note       : String(40);
        @readonly
        status     : String(1);
        amount     : Decimal(15, 2);
        modifiedAt : Timestamp @cds.on.update: $now  @odata.etag;
        items      : Composition of many Items on items.order = $self;
  }

  entity Items {
    key ID    : UUID;
        order : Association to Orders;
        qty   : Integer;
  }

  @readonly
  entity Products {
    key ID   : String(10);
        name : String(40);
  }

  @insertonly
  entity Logs {
    key ID   : Integer;
        text : String(80);
  }

  function ping(text : String) returns String;
  action reset();
}
