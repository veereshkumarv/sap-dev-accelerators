/**
 * What: Fixture: compliant handler code using bounded SELECTs and cds.log.
 * Why: Negative fixture for unbounded-query, logging, URL and org-value rules.
 * If missing or unlinked: Code rules lose their negative fixture; regressions producing false
 *     positives are not caught.
 */
const cds = require('@sap/cds');

const LOG = cds.log('orders');

module.exports = class OrderService extends cds.ApplicationService {
  init() {
    const { Orders } = this.entities;
    this.on('cancel', Orders, async (req) => {
      const order = await SELECT.one.from(Orders).where({ ID: req.params[0] });
      LOG.info('cancel requested', { id: order?.ID });
    });
    this.on('ping', async () => {
      const recent = await SELECT.from(Orders).columns('ID').limit(10);
      return `ok ${recent.length}`;
    });
    return super.init();
  }
};
