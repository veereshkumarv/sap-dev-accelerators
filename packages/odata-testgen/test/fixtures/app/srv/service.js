/**
 * What: Test fixture - implementation of the fixture service operations (ping, reset, touch).
 * Why: Operation smoke tests need real handlers; without them CAP answers 501.
 * If missing or unlinked: Generated operation smoke tests fail with 501 Not Implemented.
 */
const cds = require('@sap/cds');

module.exports = class FixtureService extends cds.ApplicationService {
  init() {
    this.on('ping', (req) => `pong ${req.data.text ?? ''}`);
    this.on('reset', () => true);
    this.on('touch', 'Notes', async (req) => {
      const key = req.params[0];
      const ID = typeof key === 'object' ? key.ID : key;
      return SELECT.one.from('FixtureService.Notes').where({ ID });
    });
    return super.init();
  }
};
