{{!
What: Template for srv/<name>-service.js - the service implementation (validation and the cancel
    action).
Why: Shows the approved handler style: class-based ApplicationService, bounded queries, cds.log,
    errors with HTTP status codes - all passing the CAP policy rules.
If missing or unlinked: create-cap-app stops with "template not found"; generated projects would
    have no business logic and the cancel action would return 501.
}}
import cds from '@sap/cds';

const LOG = cds.log('{{logger}}');

export default class {{service}} extends cds.ApplicationService {
  init() {
    const { {{entity}} } = this.entities;

    this.before(['CREATE', 'UPDATE'], {{entity}}, (req) => {
      const { netAmount } = req.data;
      if (netAmount !== undefined && netAmount !== null && Number(netAmount) < 0) {
        req.error(400, 'Net amount must not be negative.', 'netAmount');
      }
    });

    this.on('cancel', {{entity}}, async (req) => {
      const key = req.params[0];
      const ID = typeof key === 'object' ? key.ID : key;
      const current = await SELECT.one.from({{entity}}).columns('ID', 'status').where({ ID });
      if (!current) return req.error(404, `{{entityLabel}} ${ID} not found.`);
      if (current.status === 'Cancelled') return req.error(409, `{{entityLabel}} ${ID} is already cancelled.`);

      await UPDATE({{entity}}).set({ status: 'Cancelled' }).where({ ID });
      LOG.info('cancelled', { ID });
      return SELECT.one.from({{entity}}).where({ ID });
    });

    return super.init();
  }
}
