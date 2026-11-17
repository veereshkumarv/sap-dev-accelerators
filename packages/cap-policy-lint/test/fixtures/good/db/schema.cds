// What: Fixture: compliant domain model (namespace acme.sales, conventional entity/element
//     names).
// Why: Negative fixture for naming checks and the persistence layer used by the fixture service.
// If missing or unlinked: The fixture service cannot compile and every good-fixture test fails.
namespace acme.sales;

entity Orders {
  key ID          : UUID;
      customer    : String(10);
      netAmount   : Decimal(15, 2);
}
