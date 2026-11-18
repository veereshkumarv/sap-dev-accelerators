// What: CDS projection view ZC_SD_ORDER: service-specific projection of ZR_SD_ORDER.
// Why: Decouples the exposed UI service from the data model (provider contract
//     transactional_query).
// If missing or unlinked: The service definition exposes a non-existing entity; the OData
//     service cannot be activated.
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Sales Order (projection)'
@Metadata.allowExtensions: true
define root view entity ZC_SD_ORDER
  provider contract transactional_query
  as projection on ZR_SD_ORDER
{
  key OrderUUID,
      OrderId,
      Customer,
      Description,
      OrderDate,
      NetAmount,
      CurrencyCode,
      Status,
      LocalCreatedBy,
      LocalCreatedAt,
      LocalLastChangedBy,
      LocalLastChangedAt,
      LastChangedAt,
      _Item : redirected to composition child ZC_SD_ITEM
}
