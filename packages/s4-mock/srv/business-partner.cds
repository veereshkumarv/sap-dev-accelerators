// What: Mock of the released S/4HANA API API_BUSINESS_PARTNER (subset: A_BusinessPartner,
//     A_BusinessPartnerAddress, navigation to_BusinessPartnerAddress).
// Why: CAP/BTP apps integrate against the same entity and field names and the same V2 path as the
//     real API; only the destination differs.
// If missing or unlinked: Consumers of the Business Partner API get 404 from the mock; sales order
//     creation can no longer validate the sold-to party.
using { s4mock as db } from '../db/schema';

@requires: 'authenticated-user'
@path: 'API_BUSINESS_PARTNER'
service API_BUSINESS_PARTNER {
  @restrict: [ { grant: 'READ', to: 'S4Reader' }, { grant: '*', to: 'S4Writer' } ]
  entity A_BusinessPartner as projection on db.BusinessPartners {
    *,
    addresses as to_BusinessPartnerAddress
  } excluding { addresses };

  @restrict: [ { grant: 'READ', to: 'S4Reader' }, { grant: '*', to: 'S4Writer' } ]
  entity A_BusinessPartnerAddress as projection on db.BusinessPartnerAddresses;
}
