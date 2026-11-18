// What: CDS base view entity ZR_SD_ORDER for Sales Order (root of the business object), with
//     #CHECK access control.
// Why: Data model layer of the RAP business object; the behavior definition and projections
//     build on it.
// If missing or unlinked: The business object has no data model; behavior definition, projection
//     and service fail to activate.
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Sales Order'
define root view entity ZR_SD_ORDER
  as select from zsd_order
  composition [0..*] of ZR_SD_ITEM as _Item
{
  key order_uuid             as OrderUUID,
      @EndUserText.label: 'Order ID'
      order_id               as OrderId,
      @EndUserText.label: 'Customer'
      customer               as Customer,
      @EndUserText.label: 'Description'
      description            as Description,
      @EndUserText.label: 'Order Date'
      order_date             as OrderDate,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      @EndUserText.label: 'Net Amount'
      net_amount             as NetAmount,
      @EndUserText.label: 'Currency'
      currency_code          as CurrencyCode,
      @EndUserText.label: 'Status'
      status                 as Status,
      @Semantics.user.createdBy: true
      local_created_by       as LocalCreatedBy,
      @Semantics.systemDateTime.createdAt: true
      local_created_at       as LocalCreatedAt,
      @Semantics.user.localInstanceLastChangedBy: true
      local_last_changed_by  as LocalLastChangedBy,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at  as LocalLastChangedAt,
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at        as LastChangedAt,
      _Item
}
