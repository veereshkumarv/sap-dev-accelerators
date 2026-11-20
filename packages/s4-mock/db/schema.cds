// What: Persistence model of the S/4HANA mock: synthetic subsets of Business Partner, Sales Order and
//     Product data using the real API entity and field names.
// Why: Consumers switch between mock and real S/4HANA by changing only the destination; identical
//     names keep their mappings and tests valid.
// If missing or unlinked: The mock services have nothing to project and the mock cannot start.
namespace s4mock;

entity BusinessPartners {
  key BusinessPartner          : String(10);
      BusinessPartnerCategory  : String(1);   // 1 = person, 2 = organisation
      BusinessPartnerFullName  : String(81);
      FirstName                : String(40);
      LastName                 : String(40);
      OrganizationBPName1      : String(40);
      BusinessPartnerIsBlocked : Boolean default false;
      addresses                : Composition of many BusinessPartnerAddresses
                                   on addresses.BusinessPartner = BusinessPartner;
}

entity BusinessPartnerAddresses {
  key BusinessPartner : String(10);
  key AddressID       : String(10);
      CityName        : String(40);
      Country         : String(3);
      PostalCode      : String(10);
      StreetName      : String(60);
}

entity SalesOrders {
  key SalesOrder             : String(10);
      SalesOrderType         : String(4);
      SalesOrganization      : String(4);
      DistributionChannel    : String(2);
      OrganizationDivision   : String(2);
      SoldToParty            : String(10);
      CreationDate           : Date;
      TotalNetAmount         : Decimal(16, 3);
      TransactionCurrency    : String(5);
      OverallSDProcessStatus : String(1);    // A = open, C = completed
      TotalCreditCheckStatus : String(1);    // A = released, B = blocked
      items                  : Composition of many SalesOrderItems
                                 on items.SalesOrder = SalesOrder;
}

entity SalesOrderItems {
  key SalesOrder            : String(10);
  key SalesOrderItem        : String(6);
      Material              : String(40);
      RequestedQuantity     : Decimal(15, 3);
      RequestedQuantityUnit : String(3);
      NetAmount             : Decimal(16, 3);
}

entity Products {
  key Product      : String(40);
      ProductType  : String(4);
      BaseUnit     : String(3);
      ProductGroup : String(9);
      descriptions : Composition of many ProductDescriptions on descriptions.Product = Product;
}

entity ProductDescriptions {
  key Product            : String(40);
  key Language           : String(2);
      ProductDescription : String(40);
}
