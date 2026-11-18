/**
 * What: Service implementation for SalesOrdersService: input validation and the cancel action,
 *     using bounded queries and cds.log.
 * Why: Business logic lives next to the service definition (CAP convention), written to pass the
 *     CAP policy rules.
 * If missing or unlinked: CAP serves generic CRUD only: validation is skipped and the cancel
 *     action returns 501 Not Implemented.
 */
import cds from '@sap/cds';

const LOG = cds.log('sales-orders');

export default class SalesOrdersService extends cds.ApplicationService {
  init() {
    const { SalesOrders } = this.entities;

    this.before(['CREATE', 'UPDATE'], SalesOrders, (req) => {
      const { netAmount } = req.data;
      if (netAmount !== undefined && netAmount !== null && Number(netAmount) < 0) {
        req.error(400, 'Net amount must not be negative.', 'netAmount');
      }
    });

    this.on('cancel', SalesOrders, async (req) => {
      const key = req.params[0];
      const ID = typeof key === 'object' ? key.ID : key;
      const current = await SELECT.one.from(SalesOrders).columns('ID', 'status').where({ ID });
      if (!current) return req.error(404, `Sales Orders ${ID} not found.`);
      if (current.status === 'Cancelled') return req.error(409, `Sales Orders ${ID} is already cancelled.`);

      await UPDATE(SalesOrders).set({ status: 'Cancelled' }).where({ ID });
      LOG.info('cancelled', { ID });
      return SELECT.one.from(SalesOrders).where({ ID });
    });

    return super.init();
  }
}
