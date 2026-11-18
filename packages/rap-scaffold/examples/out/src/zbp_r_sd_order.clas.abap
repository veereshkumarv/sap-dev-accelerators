" What: Behavior pool ZBP_R_SD_ORDER for ZR_SD_ORDER (global class shell; logic is in the local
"     types).
" Why: Required container for the behavior implementation referenced by the behavior definition.
" If missing or unlinked: The behavior definition references a missing class; activation fails.
CLASS zbp_r_sd_order DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_sd_order.
ENDCLASS.

CLASS zbp_r_sd_order IMPLEMENTATION.
ENDCLASS.
