// What: CDS base view entity ZR_SD_ITEM for Sales Order Item (child of the business object),
//     with #CHECK access control.
// Why: Data model layer of the RAP business object; the behavior definition and projections
//     build on it.
// If missing or unlinked: The business object has no data model; behavior definition, projection
//     and service fail to activate.
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Sales Order Item'
define view entity ZR_SD_ITEM
  as select from zsd_item
  association to parent ZR_SD_ORDER as _Order
    on $projection.OrderUUID = _Order.OrderUUID
{
  key item_uuid              as ItemUUID,
      order_uuid             as OrderUUID,
      @EndUserText.label: 'Product'
      product                as Product,
      @EndUserText.label: 'Quantity'
      quantity               as Quantity,
      @EndUserText.label: 'Item Text'
      item_text              as ItemText,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at  as LocalLastChangedAt,
      _Order
}
