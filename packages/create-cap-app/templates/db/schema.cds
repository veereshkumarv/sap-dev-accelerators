{{!
What: Template for db/schema.cds - the domain model of a generated CAP project.
Why: Starts every project with a conventional, policy-compliant model (cuid/managed aspects,
    composition, typed amounts) that teams extend instead of inventing structure.
If missing or unlinked: create-cap-app stops with "template not found"; if the catalog no longer
    references it, generated projects lack a domain model and fail to compile.
}}
namespace {{namespace}};

using {
  cuid,
  managed,
  Currency
} from '@sap/cds/common';

entity {{entity}} : cuid, managed {
  description : String(255) @mandatory;
  customer    : String(10)  @mandatory;
  status      : String(20) default 'New' @readonly;
  netAmount   : Decimal(15, 2) default 0;
  currency    : Currency;
  items       : Composition of many {{itemEntity}}
                  on items.parent = $self;
}

entity {{itemEntity}} : cuid {
  parent   : Association to {{entity}};
  product  : String(40) @mandatory;
  quantity : Integer default 1 @assert.range: [1, 9999];
}
