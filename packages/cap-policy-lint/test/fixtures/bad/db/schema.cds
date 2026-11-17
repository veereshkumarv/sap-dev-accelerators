// What: Fixture: model violating naming conventions (namespace, lower-case entity, element with a
//     dash).
// Why: Positive fixture for CAP-NAME-001.
// If missing or unlinked: The bad fixture cannot compile and all positive rule tests fail.
namespace my.bookshop;

entity books {
  key ID        : Integer;
      ![Title-Name]: String;
      stock     : Integer;
}
