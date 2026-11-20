// What: Mock of the released S/4HANA API API_PRODUCT_SRV (subset: A_Product with to_Description,
//     A_ProductDescription), read-only.
// Why: Product master data lookups (descriptions, units) work offline with realistic data.
// If missing or unlinked: Product lookups against the mock return 404.
using { s4mock as db } from '../db/schema';

@requires: 'authenticated-user'
@path: 'API_PRODUCT_SRV'
service API_PRODUCT_SRV {
  @readonly
  @restrict: [ { grant: 'READ', to: 'S4Reader' } ]
  entity A_Product as projection on db.Products {
    *,
    descriptions as to_Description
  } excluding { descriptions };

  @readonly
  @restrict: [ { grant: 'READ', to: 'S4Reader' } ]
  entity A_ProductDescription as projection on db.ProductDescriptions;
}
