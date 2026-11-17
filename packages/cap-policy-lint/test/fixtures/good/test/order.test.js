/**
 * What: Fixture: test file content referencing every operation and asserting
 *     unauthorized/forbidden responses.
 * Why: Negative fixture for CAP-TEST-001/002; it is scanned as text and never executed.
 * If missing or unlinked: The good fixture would report missing tests and the "no findings" test
 *     fails.
 */
// Fixture test file: content is scanned, not executed.
const { GET, POST, expect } = require('@sap/cds').test(__dirname + '/..');
it('rejects anonymous', async () => {
  await expect(GET('/odata/v4/order/Orders')).to.be.rejectedWith(/401/);
});
it('rejects viewer writes', async () => {
  await expect(POST('/odata/v4/order/Orders', {}, { auth: { username: 'bob' } })).to.be.rejectedWith(/403/);
});
it('cancel and ping', async () => {
  await POST('/odata/v4/order/Orders(1)/OrderService.cancel', {});
  await GET('/odata/v4/order/ping()');
});
