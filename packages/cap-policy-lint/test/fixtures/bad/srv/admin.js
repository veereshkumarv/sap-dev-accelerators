/**
 * What: Fixture: handler with a hard-coded secret, endpoint and org values, unbounded SELECTs and
 *     console logging.
 * Why: Positive fixture for the code rules and JavaScript secret detection.
 * If missing or unlinked: Positive tests for CAP-CFG, CAP-PERF, CAP-LOG and JS secret detection
 *     fail.
 */
const cds = require('@sap/cds');

const clientSecret = 'sb-na-1234-very-secret-value';
const S4_URL = 'https://my-s4.example.com/sap/opu/odata/sap/API_SALES_ORDER_SRV';

module.exports = cds.service.impl(async function () {
  const { Books } = this.entities;
  this.on('READ', Books, async () => {
    console.log('reading all books');
    return SELECT.from(Books);
  });
  this.before('CREATE', Books, (req) => {
    if (req.data.CompanyCode === '1010') req.reject(400, 'not allowed');
    req.data.SalesOrganization = '1710';
  });
  this.on('stats', async () => {
    const rows = await cds.run(SELECT`from my.bookshop.books`);
    return { rows, url: `${S4_URL}`, token: clientSecret, plant: { Plant: '1010' } };
  });
});
