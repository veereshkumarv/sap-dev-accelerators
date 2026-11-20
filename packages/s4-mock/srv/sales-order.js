/**
 * What: Business behaviour of the sales order mock: validates the sold-to party, assigns sales order
 *     and item numbers, sets creation date and statuses, applies a credit block for blocked
 *     customers, totals net amounts and emits a SalesOrder.Created event.
 * Why: Integration code must be tested against the reactions of the real API (errors, numbering,
 *     credit block), not against a passive table.
 * If missing or unlinked: The mock accepts any sales order without numbers or checks, hiding
 *     integration bugs until QA.
 */
const cds = require('@sap/cds');
const { emitEvent } = require('../src/events');

const LOG = cds.log('s4-mock');

module.exports = class API_SALES_ORDER_SRV extends cds.ApplicationService {
  init() {
    const { A_SalesOrder } = this.entities;

    this.before('CREATE', A_SalesOrder, async (req) => {
      const order = req.data;
      if (!order.SoldToParty) return req.error(400, 'Sold-to party is required.', 'SoldToParty');
      const partner = await SELECT.one
        .from('s4mock.BusinessPartners')
        .columns('BusinessPartner', 'BusinessPartnerIsBlocked')
        .where({ BusinessPartner: order.SoldToParty });
      if (!partner) return req.error(400, `Sold-to party ${order.SoldToParty} does not exist.`, 'SoldToParty');

      const last = await SELECT.one.from('s4mock.SalesOrders').columns('max(SalesOrder) as max');
      order.SalesOrder = String(Math.max(Number(last?.max ?? 0), 999999) + 1);
      order.SalesOrderType ??= 'OR';
      order.CreationDate = new Date().toISOString().slice(0, 10);
      order.OverallSDProcessStatus = 'A';
      order.TotalCreditCheckStatus = partner.BusinessPartnerIsBlocked ? 'B' : 'A';
      let total = 0;
      (order.to_Item ?? []).forEach((item, i) => {
        item.SalesOrder = order.SalesOrder;
        item.SalesOrderItem = String((i + 1) * 10).padStart(6, '0');
        total += Number(item.NetAmount ?? 0);
      });
      order.TotalNetAmount = total;
    });

    // The result argument of after('CREATE') is not the record in CAP 10; req.data holds the order.
    this.after('CREATE', A_SalesOrder, async (_result, req) => {
      const order = req.data;
      LOG.info('sales order created', { SalesOrder: order.SalesOrder, creditCheck: order.TotalCreditCheckStatus });
      const webhook = cds.env.s4mock?.webhook;
      if (webhook) {
        await emitEvent(webhook, 'sap.s4.beh.salesorder.v1.SalesOrder.Created.v1', { SalesOrder: order.SalesOrder }).catch((err) =>
          LOG.warn('event delivery failed', err.message),
        );
      }
    });

    return super.init();
  }
};
