" What: ABAP Unit tests for the validations of ZR_SD_ORDER (positive and negative case) using
"     the CDS test double framework.
" Why: Every behavior implementation needs tests including a negative case (rule ABAP-TEST-001).
" If missing or unlinked: Validations are untested and the clean-core gate reports
"     ABAP-TEST-001.
"! @testing BDEF:ZR_SD_ORDER
CLASS ltc_order DEFINITION FINAL FOR TESTING
  DURATION SHORT
  RISK LEVEL HARMLESS.

  PRIVATE SECTION.
    CONSTANTS:
      uuid_1      TYPE sysuuid_x16 VALUE '00000000000000000000000000000001'.

    CLASS-DATA:
      class_under_test     TYPE REF TO lhc_order,
      cds_test_environment TYPE REF TO if_cds_test_environment.

    CLASS-METHODS class_setup.
    CLASS-METHODS class_teardown.
    METHODS setup.
    METHODS teardown.

    "! All mandatory fields set: no failed instance.
    METHODS mandatory_fields_filled FOR TESTING.
    "! All mandatory fields initial: one failed entry and one error message per field.
    METHODS mandatory_fields_missing FOR TESTING.
ENDCLASS.

CLASS ltc_order IMPLEMENTATION.

  METHOD class_setup.
    CREATE OBJECT class_under_test FOR TESTING.
    cds_test_environment = cl_cds_test_environment=>create_for_multiple_cds(
                               VALUE #( ( i_for_entity = 'ZR_SD_ORDER' ) ( i_for_entity = 'ZR_SD_ITEM' ) ) ).
    cds_test_environment->enable_double_redirection( ).
  ENDMETHOD.

  METHOD class_teardown.
    cds_test_environment->destroy( ).
  ENDMETHOD.

  METHOD setup.
    cds_test_environment->clear_doubles( ).
  ENDMETHOD.

  METHOD teardown.
    ROLLBACK ENTITIES.                                 "#EC CI_ROLLBACK
  ENDMETHOD.

  METHOD mandatory_fields_filled.
    DATA:
      mock_data TYPE STANDARD TABLE OF zsd_order WITH EMPTY KEY,
      keys      TYPE TABLE FOR VALIDATION zr_sd_order\\order~validatemandatory,
      failed    TYPE RESPONSE FOR FAILED LATE zr_sd_order,
      reported  TYPE RESPONSE FOR REPORTED LATE zr_sd_order.

    mock_data = VALUE #( ( order_uuid = uuid_1 customer = 'X' order_date = '20260101' currency_code = 'EUR' ) ).
    cds_test_environment->insert_test_data( mock_data ).
    keys = CORRESPONDING #( mock_data MAPPING OrderUUID = order_uuid ).

    class_under_test->validatemandatory( EXPORTING keys     = keys
                                         CHANGING  failed   = failed
                                                   reported = reported ).

    cl_abap_unit_assert=>assert_initial( failed ).
  ENDMETHOD.

  METHOD mandatory_fields_missing.
    DATA:
      mock_data TYPE STANDARD TABLE OF zsd_order WITH EMPTY KEY,
      keys      TYPE TABLE FOR VALIDATION zr_sd_order\\order~validatemandatory,
      failed    TYPE RESPONSE FOR FAILED LATE zr_sd_order,
      reported  TYPE RESPONSE FOR REPORTED LATE zr_sd_order.

    mock_data = VALUE #( ( order_uuid = uuid_1 ) ).
    cds_test_environment->insert_test_data( mock_data ).
    keys = CORRESPONDING #( mock_data MAPPING OrderUUID = order_uuid ).

    class_under_test->validatemandatory( EXPORTING keys     = keys
                                         CHANGING  failed   = failed
                                                   reported = reported ).

    cl_abap_unit_assert=>assert_equals( exp = 3
                                        act = lines( failed-order ) ).
    cl_abap_unit_assert=>assert_not_initial( reported-order ).
  ENDMETHOD.

ENDCLASS.

"! @testing BDEF:ZR_SD_ORDER
CLASS ltc_item DEFINITION FINAL FOR TESTING
  DURATION SHORT
  RISK LEVEL HARMLESS.

  PRIVATE SECTION.
    CONSTANTS:
      uuid_1      TYPE sysuuid_x16 VALUE '00000000000000000000000000000001',
      uuid_parent TYPE sysuuid_x16 VALUE '000000000000000000000000000000FF'.

    CLASS-DATA:
      class_under_test     TYPE REF TO lhc_item,
      cds_test_environment TYPE REF TO if_cds_test_environment.

    CLASS-METHODS class_setup.
    CLASS-METHODS class_teardown.
    METHODS setup.
    METHODS teardown.

    "! All mandatory fields set: no failed instance.
    METHODS mandatory_fields_filled FOR TESTING.
    "! All mandatory fields initial: one failed entry and one error message per field.
    METHODS mandatory_fields_missing FOR TESTING.
ENDCLASS.

CLASS ltc_item IMPLEMENTATION.

  METHOD class_setup.
    CREATE OBJECT class_under_test FOR TESTING.
    cds_test_environment = cl_cds_test_environment=>create_for_multiple_cds(
                               VALUE #( ( i_for_entity = 'ZR_SD_ORDER' ) ( i_for_entity = 'ZR_SD_ITEM' ) ) ).
    cds_test_environment->enable_double_redirection( ).
  ENDMETHOD.

  METHOD class_teardown.
    cds_test_environment->destroy( ).
  ENDMETHOD.

  METHOD setup.
    cds_test_environment->clear_doubles( ).
  ENDMETHOD.

  METHOD teardown.
    ROLLBACK ENTITIES.                                 "#EC CI_ROLLBACK
  ENDMETHOD.

  METHOD mandatory_fields_filled.
    DATA:
      mock_data TYPE STANDARD TABLE OF zsd_item WITH EMPTY KEY,
      keys      TYPE TABLE FOR VALIDATION zr_sd_order\\item~validatemandatory,
      failed    TYPE RESPONSE FOR FAILED LATE zr_sd_order,
      reported  TYPE RESPONSE FOR REPORTED LATE zr_sd_order.

    mock_data = VALUE #( ( item_uuid = uuid_1 order_uuid = uuid_parent product = 'X' quantity = 1 ) ).
    cds_test_environment->insert_test_data( mock_data ).
    keys = CORRESPONDING #( mock_data MAPPING ItemUUID = item_uuid ).

    class_under_test->validatemandatory( EXPORTING keys     = keys
                                         CHANGING  failed   = failed
                                                   reported = reported ).

    cl_abap_unit_assert=>assert_initial( failed ).
  ENDMETHOD.

  METHOD mandatory_fields_missing.
    DATA:
      mock_data TYPE STANDARD TABLE OF zsd_item WITH EMPTY KEY,
      keys      TYPE TABLE FOR VALIDATION zr_sd_order\\item~validatemandatory,
      failed    TYPE RESPONSE FOR FAILED LATE zr_sd_order,
      reported  TYPE RESPONSE FOR REPORTED LATE zr_sd_order.

    mock_data = VALUE #( ( item_uuid = uuid_1 order_uuid = uuid_parent ) ).
    cds_test_environment->insert_test_data( mock_data ).
    keys = CORRESPONDING #( mock_data MAPPING ItemUUID = item_uuid ).

    class_under_test->validatemandatory( EXPORTING keys     = keys
                                         CHANGING  failed   = failed
                                                   reported = reported ).

    cl_abap_unit_assert=>assert_equals( exp = 2
                                        act = lines( failed-item ) ).
    cl_abap_unit_assert=>assert_not_initial( reported-item ).
  ENDMETHOD.

ENDCLASS.
