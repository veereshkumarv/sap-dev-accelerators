<!--
What: Catalog of all generated files with What / Why / If missing.
Why: Documents files that cannot carry an inline header (abapGit XML).
If missing or unlinked: XML metadata files are undocumented.
-->

# Files in ZR_SD_ORDER

Source files carry this information as a header comment; abapGit XML metadata is documented here only.

## `.abapgit.xml`

- **What:** abapGit repository descriptor (starting folder /src/, prefix folder logic, master language E).
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit does not recognise the repository and imports nothing.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `README.md`

- **What:** Generated RAP business object ZR_SD_ORDER (Sales order (RAP example)) in abapGit format.
- **Why:** Explains how to import, activate, publish and verify the generated objects.
- **If missing or unlinked:** Importers do not know the prerequisites (authorization object, package) or the activation order.

## `docs/files.md`

- **What:** Catalog of all generated files with What / Why / If missing.
- **Why:** Documents files that cannot carry an inline header (abapGit XML).
- **If missing or unlinked:** XML metadata files are undocumented.

## `src/package.devc.xml`

- **What:** Package ZSD_ORDERS: Sales order (RAP example).
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the target package; objects have no package.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zbp_r_sd_order.clas.abap`

- **What:** Behavior pool ZBP_R_SD_ORDER for ZR_SD_ORDER (global class shell; logic is in the local types).
- **Why:** Required container for the behavior implementation referenced by the behavior definition.
- **If missing or unlinked:** The behavior definition references a missing class; activation fails.

## `src/zbp_r_sd_order.clas.locals_imp.abap`

- **What:** Behavior handlers of ZR_SD_ORDER: global authorization via AUTHORITY-CHECK on ZSD_ORDER and mandatory-field validations.
- **Why:** Implements secure-by-default authorization and data quality checks with released APIs only (ABAP Cloud).
- **If missing or unlinked:** Authorization and validations are not implemented; the behavior definition fails to activate.

## `src/zbp_r_sd_order.clas.testclasses.abap`

- **What:** ABAP Unit tests for the validations of ZR_SD_ORDER (positive and negative case) using the CDS test double framework.
- **Why:** Every behavior implementation needs tests including a negative case (rule ABAP-TEST-001).
- **If missing or unlinked:** Validations are untested and the clean-core gate reports ABAP-TEST-001.

## `src/zbp_r_sd_order.clas.xml`

- **What:** Metadata of behavior pool ZBP_R_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the behavior pool.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zc_sd_item.dcls.asdcls`

- **What:** Access control for ZC_SD_ITEM, inheriting the conditions of ZR_SD_ITEM.
- **Why:** Projections must enforce the same authorization as the base view.
- **If missing or unlinked:** The projection is not protected by an access control; ABAP-SEC-001 is violated.

## `src/zc_sd_item.dcls.xml`

- **What:** Metadata of access control ZC_SD_ITEM.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the access control.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zc_sd_item.ddls.asddls`

- **What:** CDS projection view ZC_SD_ITEM: service-specific projection of ZR_SD_ITEM.
- **Why:** Decouples the exposed UI service from the data model (provider contract transactional_query).
- **If missing or unlinked:** The service definition exposes a non-existing entity; the OData service cannot be activated.

## `src/zc_sd_item.ddls.xml`

- **What:** Metadata of projection view ZC_SD_ITEM.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create ZC_SD_ITEM.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zc_sd_item.ddlx.asddlxs`

- **What:** UI metadata extension for ZC_SD_ITEM: Fiori elements list, object page and facets.
- **Why:** Keeps UI annotations out of the data model and lets the customer layer adjust the UI.
- **If missing or unlinked:** The Fiori elements preview shows no columns or facets; the service itself still works.

## `src/zc_sd_item.ddlx.xml`

- **What:** Metadata of metadata extension ZC_SD_ITEM.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the metadata extension.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zc_sd_order.bdef.asbdef`

- **What:** Projection behavior definition of ZC_SD_ORDER: operations exposed to the UI service.
- **Why:** Only operations listed here are available to the service consumer.
- **If missing or unlinked:** The UI service is read-only; create, update, delete and draft actions are not exposed.

## `src/zc_sd_order.bdef.xml`

- **What:** Metadata of projection behavior definition ZC_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the projection behavior definition.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zc_sd_order.dcls.asdcls`

- **What:** Access control for ZC_SD_ORDER, inheriting the conditions of ZR_SD_ORDER.
- **Why:** Projections must enforce the same authorization as the base view.
- **If missing or unlinked:** The projection is not protected by an access control; ABAP-SEC-001 is violated.

## `src/zc_sd_order.dcls.xml`

- **What:** Metadata of access control ZC_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the access control.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zc_sd_order.ddls.asddls`

- **What:** CDS projection view ZC_SD_ORDER: service-specific projection of ZR_SD_ORDER.
- **Why:** Decouples the exposed UI service from the data model (provider contract transactional_query).
- **If missing or unlinked:** The service definition exposes a non-existing entity; the OData service cannot be activated.

## `src/zc_sd_order.ddls.xml`

- **What:** Metadata of projection view ZC_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create ZC_SD_ORDER.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zc_sd_order.ddlx.asddlxs`

- **What:** UI metadata extension for ZC_SD_ORDER: Fiori elements list, object page and facets.
- **Why:** Keeps UI annotations out of the data model and lets the customer layer adjust the UI.
- **If missing or unlinked:** The Fiori elements preview shows no columns or facets; the service itself still works.

## `src/zc_sd_order.ddlx.xml`

- **What:** Metadata of metadata extension ZC_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the metadata extension.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zr_sd_item.dcls.asdcls`

- **What:** Access control for ZR_SD_ITEM: read access requires authorization object ZSD_ORDER with ACTVT 03.
- **Why:** Secure by default (rule ABAP-SEC-001): rows are only visible to users with the authorization.
- **If missing or unlinked:** ZR_SD_ITEM declares #CHECK without a role: activation warns and all users would see no data or, if changed to #NOT_REQUIRED, all data.

## `src/zr_sd_item.dcls.xml`

- **What:** Metadata of access control ZR_SD_ITEM.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the access control.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zr_sd_item.ddls.asddls`

- **What:** CDS base view entity ZR_SD_ITEM for Sales Order Item (child of the business object), with #CHECK access control.
- **Why:** Data model layer of the RAP business object; the behavior definition and projections build on it.
- **If missing or unlinked:** The business object has no data model; behavior definition, projection and service fail to activate.

## `src/zr_sd_item.ddls.xml`

- **What:** Metadata of CDS view entity ZR_SD_ITEM.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create ZR_SD_ITEM.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zr_sd_order.bdef.asbdef`

- **What:** Behavior definition of ZR_SD_ORDER: managed, strict(2), draft-enabled, global authorization, mandatory-field validations, field mappings.
- **Why:** Defines the transactional behavior of the business object (create/update/delete, locks, ETags, validations).
- **If missing or unlinked:** The business object is read-only CDS; projection behavior, service and Fiori app cannot modify data.

## `src/zr_sd_order.bdef.xml`

- **What:** Metadata of behavior definition ZR_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the behavior definition.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zr_sd_order.dcls.asdcls`

- **What:** Access control for ZR_SD_ORDER: read access requires authorization object ZSD_ORDER with ACTVT 03.
- **Why:** Secure by default (rule ABAP-SEC-001): rows are only visible to users with the authorization.
- **If missing or unlinked:** ZR_SD_ORDER declares #CHECK without a role: activation warns and all users would see no data or, if changed to #NOT_REQUIRED, all data.

## `src/zr_sd_order.dcls.xml`

- **What:** Metadata of access control ZR_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the access control.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zr_sd_order.ddls.asddls`

- **What:** CDS base view entity ZR_SD_ORDER for Sales Order (root of the business object), with #CHECK access control.
- **Why:** Data model layer of the RAP business object; the behavior definition and projections build on it.
- **If missing or unlinked:** The business object has no data model; behavior definition, projection and service fail to activate.

## `src/zr_sd_order.ddls.xml`

- **What:** Metadata of CDS view entity ZR_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create ZR_SD_ORDER.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zsd_item.tabl.xml`

- **What:** Database table ZSD_ITEM: active persistence of Sales Order Item (ZR_SD_ITEM) with UUID key, business and administrative fields.
- **Why:** Persistent table of the managed RAP business object; field names are mapped in the behavior definition.
- **If missing or unlinked:** ZR_SD_ITEM and the behavior definition reference a non-existing table; activation fails.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zsd_item_d.tabl.xml`

- **What:** Draft table ZSD_ITEM_D of Sales Order Item (ZR_SD_ITEM) with the draft administration include.
- **Why:** RAP draft handling stores unsaved user changes here (fields named after the CDS elements).
- **If missing or unlinked:** The behavior definition "draft table" clause fails; draft-enabled Fiori apps cannot save drafts.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zsd_order.tabl.xml`

- **What:** Database table ZSD_ORDER: active persistence of Sales Order (ZR_SD_ORDER) with UUID key, business and administrative fields.
- **Why:** Persistent table of the managed RAP business object; field names are mapped in the behavior definition.
- **If missing or unlinked:** ZR_SD_ORDER and the behavior definition reference a non-existing table; activation fails.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zsd_order_d.tabl.xml`

- **What:** Draft table ZSD_ORDER_D of Sales Order (ZR_SD_ORDER) with the draft administration include.
- **Why:** RAP draft handling stores unsaved user changes here (fields named after the CDS elements).
- **If missing or unlinked:** The behavior definition "draft table" clause fails; draft-enabled Fiori apps cannot save drafts.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zui_sd_order.srvd.srvdsrv`

- **What:** Service definition ZUI_SD_ORDER: exposes ZC_SD_ORDER, ZC_SD_ITEM.
- **Why:** Defines the scope of the OData service bound by the service binding.
- **If missing or unlinked:** The service binding has nothing to expose; no OData service exists.

## `src/zui_sd_order.srvd.xml`

- **What:** Metadata of service definition ZUI_SD_ORDER.
- **Why:** abapGit object metadata required to create the object on import.
- **If missing or unlinked:** abapGit cannot create the service definition.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.

## `src/zui_sd_order_o4.srvb.xml`

- **What:** Service binding ZUI_SD_ORDER_O4: OData V4 UI binding of ZUI_SD_ORDER, imported unpublished.
- **Why:** Makes the service reachable as OData V4 for Fiori elements after explicit publishing in ADT.
- **If missing or unlinked:** The service cannot be published or previewed.
- **No inline header:** abapGit regenerates XML metadata on every serialization; an inline comment would be removed on the next export.
