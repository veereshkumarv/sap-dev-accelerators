// What: CDS projection view ZC_SD_ITEM: service-specific projection of ZR_SD_ITEM.
// Why: Decouples the exposed UI service from the data model (provider contract
//     transactional_query).
// If missing or unlinked: The service definition exposes a non-existing entity; the OData
//     service cannot be activated.
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Sales Order Item (projection)'
@Metadata.allowExtensions: true
define view entity ZC_SD_ITEM
  as projection on ZR_SD_ITEM
{
  key ItemUUID,
      OrderUUID,
      Product,
      Quantity,
      ItemText,
      LocalLastChangedAt,
      _Order : redirected to parent ZC_SD_ORDER
}
