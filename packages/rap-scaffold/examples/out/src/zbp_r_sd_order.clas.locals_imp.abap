" What: Behavior handlers of ZR_SD_ORDER: global authorization via AUTHORITY-CHECK on ZSD_ORDER
"     and mandatory-field validations.
" Why: Implements secure-by-default authorization and data quality checks with released APIs
"     only (ABAP Cloud).
" If missing or unlinked: Authorization and validations are not implemented; the behavior
"     definition fails to activate.
CLASS ltc_order DEFINITION DEFERRED FOR TESTING.
CLASS ltc_item DEFINITION DEFERRED FOR TESTING.

CLASS lhc_order DEFINITION INHERITING FROM cl_abap_behavior_handler FRIENDS ltc_order.
  PRIVATE SECTION.
    CONSTANTS:
      BEGIN OF activity,
        create TYPE c LENGTH 2 VALUE '01',
        change TYPE c LENGTH 2 VALUE '02',
        delete TYPE c LENGTH 2 VALUE '06',
      END OF activity.

    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Order RESULT result.

    METHODS is_granted
      IMPORTING activity      TYPE c
      RETURNING VALUE(result) TYPE abap_bool.

    METHODS validatemandatory FOR VALIDATE ON SAVE
      IMPORTING keys FOR Order~validateMandatory.
ENDCLASS.

CLASS lhc_order IMPLEMENTATION.
  METHOD get_global_authorizations.
    IF requested_authorizations-%create = if_abap_behv=>mk-on.
      result-%create = COND #( WHEN is_granted( activity-create ) = abap_true
                                 THEN if_abap_behv=>auth-allowed
                                 ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.
    IF requested_authorizations-%update = if_abap_behv=>mk-on.
      result-%update = COND #( WHEN is_granted( activity-change ) = abap_true
                                 THEN if_abap_behv=>auth-allowed
                                 ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.
    IF requested_authorizations-%delete = if_abap_behv=>mk-on.
      result-%delete = COND #( WHEN is_granted( activity-delete ) = abap_true
                                 THEN if_abap_behv=>auth-allowed
                                 ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.
    IF requested_authorizations-%action-Edit = if_abap_behv=>mk-on.
      result-%action-Edit = COND #( WHEN is_granted( activity-change ) = abap_true
                                 THEN if_abap_behv=>auth-allowed
                                 ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.
  ENDMETHOD.

  METHOD is_granted.
    AUTHORITY-CHECK OBJECT 'ZSD_ORDER' ID 'ACTVT' FIELD activity.
    result = xsdbool( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD validatemandatory.
    READ ENTITIES OF zr_sd_order IN LOCAL MODE
      ENTITY Order
        FIELDS ( Customer OrderDate CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(instances).

    LOOP AT instances INTO DATA(instance).
      APPEND VALUE #( %tky = instance-%tky %state_area = 'VALIDATE_MANDATORY' ) TO reported-order.
      IF instance-Customer IS INITIAL.
        APPEND VALUE #( %tky = instance-%tky ) TO failed-order.
        APPEND VALUE #( %tky = instance-%tky
                        %state_area = 'VALIDATE_MANDATORY'
                        %msg = new_message_with_text( severity = if_abap_behv_message=>severity-error
                                                      text     = 'Customer is mandatory.' )
                        %element-Customer = if_abap_behv=>mk-on ) TO reported-order.
      ENDIF.
      IF instance-OrderDate IS INITIAL.
        APPEND VALUE #( %tky = instance-%tky ) TO failed-order.
        APPEND VALUE #( %tky = instance-%tky
                        %state_area = 'VALIDATE_MANDATORY'
                        %msg = new_message_with_text( severity = if_abap_behv_message=>severity-error
                                                      text     = 'Order Date is mandatory.' )
                        %element-OrderDate = if_abap_behv=>mk-on ) TO reported-order.
      ENDIF.
      IF instance-CurrencyCode IS INITIAL.
        APPEND VALUE #( %tky = instance-%tky ) TO failed-order.
        APPEND VALUE #( %tky = instance-%tky
                        %state_area = 'VALIDATE_MANDATORY'
                        %msg = new_message_with_text( severity = if_abap_behv_message=>severity-error
                                                      text     = 'Currency is mandatory.' )
                        %element-CurrencyCode = if_abap_behv=>mk-on ) TO reported-order.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.

CLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler FRIENDS ltc_item.
  PRIVATE SECTION.
    METHODS validatemandatory FOR VALIDATE ON SAVE
      IMPORTING keys FOR Item~validateMandatory.
ENDCLASS.

CLASS lhc_item IMPLEMENTATION.
  METHOD validatemandatory.
    READ ENTITIES OF zr_sd_order IN LOCAL MODE
      ENTITY Item
        FIELDS ( Product Quantity ) WITH CORRESPONDING #( keys )
      RESULT DATA(instances).

    LOOP AT instances INTO DATA(instance).
      APPEND VALUE #( %tky = instance-%tky %state_area = 'VALIDATE_MANDATORY' ) TO reported-item.
      IF instance-Product IS INITIAL.
        APPEND VALUE #( %tky = instance-%tky ) TO failed-item.
        APPEND VALUE #( %tky = instance-%tky
                        %state_area = 'VALIDATE_MANDATORY'
                        %msg = new_message_with_text( severity = if_abap_behv_message=>severity-error
                                                      text     = 'Product is mandatory.' )
                        %element-Product = if_abap_behv=>mk-on ) TO reported-item.
      ENDIF.
      IF instance-Quantity IS INITIAL.
        APPEND VALUE #( %tky = instance-%tky ) TO failed-item.
        APPEND VALUE #( %tky = instance-%tky
                        %state_area = 'VALIDATE_MANDATORY'
                        %msg = new_message_with_text( severity = if_abap_behv_message=>severity-error
                                                      text     = 'Quantity is mandatory.' )
                        %element-Quantity = if_abap_behv=>mk-on ) TO reported-item.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
