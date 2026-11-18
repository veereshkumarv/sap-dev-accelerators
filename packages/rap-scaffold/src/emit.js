/**
 * What: Emits the RAP source code of a business object: CDS base and projection view entities,
 *     UI metadata extensions, access controls (DCL), base and projection behavior definitions,
 *     the behavior pool (handler, authorization, validations), ABAP Unit tests and the service
 *     definition.
 * Why: Generated sources follow the approved clean-core pattern - ABAP Cloud syntax, released
 *     APIs only, #CHECK access control with pfcg_auth, global authorization via AUTHORITY-CHECK,
 *     validations with a negative unit test - so teams start compliant instead of fixing later.
 * If missing or unlinked: No RAP sources are generated; only empty object metadata would remain.
 */

/** @typedef {import('./model.js').Model} Model */
/** @typedef {import('./model.js').Entity} Entity */
/** @typedef {import('./model.js').Field} Field */

const ADMIN_ANNOTATION = {
  createdBy: '@Semantics.user.createdBy: true',
  createdAt: '@Semantics.systemDateTime.createdAt: true',
  localChangedBy: '@Semantics.user.localInstanceLastChangedBy: true',
  localChangedAt: '@Semantics.systemDateTime.localInstanceLastChangedAt: true',
  lastChangedAt: '@Semantics.systemDateTime.lastChangedAt: true',
};

/** @param {string} s */
const quote = (s) => `'${s.replace(/'/g, "''")}'`;
/** @param {Field} f */
const isBusiness = (f) => !f.key && !f.admin && !f.parentKey;

/**
 * @param {Model} model
 * @param {Entity} entity
 */
export function baseView(model, entity) {
  const root = model.root;
  const relations = entity.isRoot
    ? model.children.map((c) => `  composition [0..*] of ${c.names.baseView} as ${c.assoc}`)
    : [`  association to parent ${root.names.baseView} as ${root.assoc}\n    on $projection.${root.alias}UUID = ${root.assoc}.${root.alias}UUID`];
  const width = Math.max(...entity.fields.map((f) => f.column.length)) + 2;
  const elements = entity.fields.map((f) => {
    /** @type {string[]} */
    const annotations = [];
    if (f.admin) annotations.push(ADMIN_ANNOTATION[f.admin]);
    if (f.type.kind === 'builtin' && f.type.type === 'curr' && f.currency) annotations.push(`@Semantics.amount.currencyCode: ${quote(f.currency)}`);
    if (f.type.kind === 'builtin' && !f.admin) annotations.push(`@EndUserText.label: ${quote(f.label)}`);
    const line = `${f.key ? 'key ' : '    '}${f.column.toLowerCase().padEnd(width)}as ${f.element}`;
    return [...annotations.map((a) => `      ${a}`), `  ${line}`].join('\n');
  });
  const assocs = entity.isRoot ? model.children.map((c) => c.assoc) : [root.assoc];
  return `@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: ${quote(entity.label)}
define ${entity.isRoot ? 'root ' : ''}view entity ${entity.names.baseView}
  as select from ${entity.names.table.toLowerCase()}
${relations.join('\n')}
{
${[...elements, ...assocs.map((a) => `      ${a}`)].join(',\n')}
}
`;
}

/**
 * @param {Model} model
 * @param {Entity} entity
 */
export function projectionView(model, entity) {
  const root = model.root;
  const elements = entity.fields.map((f) => `  ${f.key ? 'key ' : '    '}${f.element}`);
  const assocs = entity.isRoot
    ? model.children.map((c) => `      ${c.assoc} : redirected to composition child ${c.names.projectionView}`)
    : [`      ${root.assoc} : redirected to parent ${root.names.projectionView}`];
  return `@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: ${quote(`${entity.label} (projection)`)}
@Metadata.allowExtensions: true
define ${entity.isRoot ? 'root ' : ''}view entity ${entity.names.projectionView}
${entity.isRoot ? '  provider contract transactional_query\n' : ''}  as projection on ${entity.names.baseView}
{
${[...elements, ...assocs].join(',\n')}
}
`;
}

/**
 * Fiori elements UI annotations (list report / object page).
 * @param {Model} model
 * @param {Entity} entity
 */
export function metadataExtension(model, entity) {
  const business = entity.fields.filter(isBusiness);
  const facets = [
    `{ id: 'General', purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: ${quote(entity.label)}, position: 10 }`,
    ...(entity.isRoot
      ? model.children.map(
          (c, i) => `{ id: ${quote(c.alias)}, purpose: #STANDARD, type: #LINEITEM_REFERENCE, label: ${quote(c.label)}, position: ${(i + 2) * 10}, targetElement: ${quote(c.assoc)} }`,
        )
      : []),
  ];
  const hidden = entity.fields.filter((f) => f.key || f.parentKey).map((f) => `  @UI.hidden: true\n  ${f.element};`);
  const visible = business.map((f, i) => {
    const pos = (i + 1) * 10;
    const selection = entity.isRoot && i < 3 ? `,\n         selectionField: [ { position: ${pos} } ]` : '';
    return `  @UI: { lineItem:       [ { position: ${pos} } ],\n         identification: [ { position: ${pos} } ]${selection} }\n  ${f.element};`;
  });
  const title = business[0] ? `,\n                     title: { type: #STANDARD, value: ${quote(business[0].element)} }` : '';
  return `@Metadata.layer: #CUSTOMER
@UI: { headerInfo: { typeName: ${quote(entity.label)},
                     typeNamePlural: ${quote(`${entity.label}s`)}${title} } }
annotate entity ${entity.names.projectionView} with
{
  @UI.facet: [ ${facets.join(',\n               ')} ]
${[...hidden, ...visible].join('\n\n')}
}
`;
}

/**
 * Base access control: read access requires the customer authorization object with ACTVT 03.
 * @param {Model} model
 * @param {Entity} entity
 */
export function baseAccessControl(model, entity) {
  return `@EndUserText.label: ${quote(`Access control for ${entity.names.baseView}`)}
@MappingRole: true
define role ${entity.names.accessControl} {
  grant select on ${entity.names.baseView}
    where ( ) = aspect pfcg_auth( ${model.authorizationObject}, ACTVT = '03' );
}
`;
}

/**
 * @param {Entity} entity
 */
export function projectionAccessControl(entity) {
  return `@EndUserText.label: ${quote(`Access control for ${entity.names.projectionView}`)}
@MappingRole: true
define role ${entity.names.projectionAccessControl} {
  grant select on ${entity.names.projectionView}
    where inheriting conditions from entity ${entity.names.baseView};
}
`;
}

/** @param {Entity} e */
const mandatoryOf = (e) => e.fields.filter((f) => f.mandatory);

/**
 * @param {Model} model
 */
export function baseBehavior(model) {
  const { root, draft } = model;
  const pool = root.names.behaviorPool;
  const block = (/** @type {Entity} */ e) => {
    const mandatory = mandatoryOf(e);
    const readonly = e.fields.filter((f) => !f.key && (f.readonly || f.parentKey));
    const width = Math.max(...e.fields.map((f) => f.element.length));
    const header = [
      `define behavior for ${e.names.baseView} alias ${e.alias}`,
      ...(e.isRoot || mandatory.length ? [`implementation in class ${pool} unique`] : []),
      `persistent table ${e.names.table}`,
      ...(draft ? [`draft table ${e.names.draftTable}`] : []),
      ...(e.isRoot ? ['lock master', ...(draft ? ['total etag LastChangedAt'] : []), 'authorization master ( global )'] : [`lock dependent by ${root.assoc}`, `authorization dependent by ${root.assoc}`]),
      'etag master LocalLastChangedAt',
    ];
    /** @type {string[]} */
    const body = [];
    if (e.isRoot) body.push('create;');
    body.push('update;', 'delete;');
    if (e.isRoot) for (const c of model.children) body.push(`association ${c.assoc} { create;${draft ? ' with draft;' : ''} }`);
    else body.push(draft ? `association ${root.assoc} { with draft; }` : `association ${root.assoc};`);
    body.push('');
    body.push(`field ( numbering : managed, readonly ) ${e.fields[0].element};`);
    if (readonly.length) body.push(`field ( readonly ) ${readonly.map((f) => f.element).join(', ')};`);
    if (mandatory.length) {
      body.push(`field ( mandatory ) ${mandatory.map((f) => f.element).join(', ')};`, '');
      body.push(`validation validateMandatory on save { create; field ${mandatory.map((f) => f.element).join(', ')}; }`);
    }
    if (e.isRoot && draft) {
      const validations = [root, ...model.children]
        .filter((x) => mandatoryOf(x).length)
        .map((x) => `    validation ${x.isRoot ? '' : `${x.alias}~`}validateMandatory;`);
      body.push('', 'draft action Resume;', 'draft action Edit;', 'draft action Activate optimized;', 'draft action Discard;');
      body.push(validations.length ? `draft determine action Prepare\n  {\n${validations.join('\n')}\n  }` : 'draft determine action Prepare;');
    }
    body.push('', `mapping for ${e.names.table.toLowerCase()}`, '  {');
    for (const f of e.fields) body.push(`    ${f.element.padEnd(width)} = ${f.column.toLowerCase()};`);
    body.push('  }');
    return `${header.join('\n')}\n{\n${body.map((l) => (l ? `  ${l}` : '')).join('\n')}\n}`;
  };
  return `managed;
strict ( 2 );
${draft ? 'with draft;\n' : ''}
${[root, ...model.children].map(block).join('\n\n')}
`;
}

/**
 * @param {Model} model
 */
export function projectionBehavior(model) {
  const { root, draft } = model;
  const block = (/** @type {Entity} */ e) => {
    /** @type {string[]} */
    const body = [];
    if (e.isRoot) body.push('use create;');
    body.push('use update;', 'use delete;');
    if (e.isRoot && draft) body.push('', 'use action Edit;', 'use action Activate;', 'use action Discard;', 'use action Resume;', 'use action Prepare;');
    body.push('');
    if (e.isRoot) for (const c of model.children) body.push(`use association ${c.assoc} { create;${draft ? ' with draft;' : ''} }`);
    else body.push(draft ? `use association ${root.assoc} { with draft; }` : `use association ${root.assoc};`);
    return `define behavior for ${e.names.projectionView} alias ${e.alias}\nuse etag\n{\n${body.map((l) => (l ? `  ${l}` : '')).join('\n')}\n}`;
  };
  return `projection;
strict ( 2 );
${draft ? 'use draft;\n' : ''}
${[root, ...model.children].map(block).join('\n\n')}
`;
}

/**
 * @param {Model} model
 */
export function serviceDefinition(model) {
  const { root } = model;
  const width = Math.max(...[root, ...model.children].map((e) => e.names.projectionView.length));
  return `@EndUserText.label: ${quote(model.description)}
@ObjectModel.leadingEntity.name: ${quote(root.names.projectionView)}
define service ${root.names.serviceDefinition} {
${[root, ...model.children].map((e) => `  expose ${e.names.projectionView.padEnd(width)} as ${e.alias};`).join('\n')}
}
`;
}

/** @param {Entity} e */
const handlerOf = (e) => `lhc_${e.alias.toLowerCase()}`;
/** @param {Entity} e */
const testOf = (e) => `ltc_${e.alias.toLowerCase()}`;
/** @param {Model} model */
const handledEntities = (model) => [model.root, ...model.children].filter((e) => e.isRoot || mandatoryOf(e).length);

/**
 * @param {Model} model
 */
export function behaviorPoolMain(model) {
  const pool = model.root.names.behaviorPool.toLowerCase();
  return `CLASS ${pool} DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF ${model.root.names.baseView.toLowerCase()}.
ENDCLASS.

CLASS ${pool} IMPLEMENTATION.
ENDCLASS.
`;
}

/**
 * Local handler classes: global authorization (root) and mandatory-field validations.
 * @param {Model} model
 */
export function behaviorPoolLocals(model) {
  const bo = model.root.names.baseView.toLowerCase();
  const entities = handledEntities(model);
  const deferred = entities.filter((e) => mandatoryOf(e).length).map((e) => `CLASS ${testOf(e)} DEFINITION DEFERRED FOR TESTING.`);

  const classes = entities.map((e) => {
    const mandatory = mandatoryOf(e);
    const friends = mandatory.length ? ` FRIENDS ${testOf(e)}` : '';
    const reportedTab = e.alias.toLowerCase();
    /** @type {string[]} */
    const defs = [];
    /** @type {string[]} */
    const impls = [];

    if (e.isRoot) {
      defs.push(
        `    CONSTANTS:
      BEGIN OF activity,
        create TYPE c LENGTH 2 VALUE '01',
        change TYPE c LENGTH 2 VALUE '02',
        delete TYPE c LENGTH 2 VALUE '06',
      END OF activity.

    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR ${e.alias} RESULT result.

    METHODS is_granted
      IMPORTING activity      TYPE c
      RETURNING VALUE(result) TYPE abap_bool.`,
      );
      const grant = (/** @type {string} */ target, /** @type {string} */ act) => `    IF requested_authorizations-${target} = if_abap_behv=>mk-on.
      result-${target} = COND #( WHEN is_granted( activity-${act} ) = abap_true
                                 THEN if_abap_behv=>auth-allowed
                                 ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.`;
      impls.push(
        `  METHOD get_global_authorizations.
${[grant('%create', 'create'), grant('%update', 'change'), grant('%delete', 'delete'), ...(model.draft ? [grant('%action-Edit', 'change')] : [])].join('\n')}
  ENDMETHOD.

  METHOD is_granted.
    AUTHORITY-CHECK OBJECT '${model.authorizationObject}' ID 'ACTVT' FIELD activity.
    result = xsdbool( sy-subrc = 0 ).
  ENDMETHOD.`,
      );
    }

    if (mandatory.length) {
      defs.push(`    METHODS validatemandatory FOR VALIDATE ON SAVE
      IMPORTING keys FOR ${e.alias}~validateMandatory.`);
      const stateArea = model.draft ? "\n                        %state_area = 'VALIDATE_MANDATORY'" : '';
      const checks = mandatory
        .map(
          (f) => `      IF instance-${f.element} IS INITIAL.
        APPEND VALUE #( %tky = instance-%tky ) TO failed-${reportedTab}.
        APPEND VALUE #( %tky = instance-%tky${stateArea}
                        %msg = new_message_with_text( severity = if_abap_behv_message=>severity-error
                                                      text     = ${quote(`${f.label} is mandatory.`)} )
                        %element-${f.element} = if_abap_behv=>mk-on ) TO reported-${reportedTab}.
      ENDIF.`,
        )
        .join('\n');
      impls.push(`  METHOD validatemandatory.
    READ ENTITIES OF ${bo} IN LOCAL MODE
      ENTITY ${e.alias}
        FIELDS ( ${mandatory.map((f) => f.element).join(' ')} ) WITH CORRESPONDING #( keys )
      RESULT DATA(instances).

    LOOP AT instances INTO DATA(instance).
${model.draft ? `      APPEND VALUE #( %tky = instance-%tky %state_area = 'VALIDATE_MANDATORY' ) TO reported-${reportedTab}.\n` : ''}${checks}
    ENDLOOP.
  ENDMETHOD.`);
    }

    return `CLASS ${handlerOf(e)} DEFINITION INHERITING FROM cl_abap_behavior_handler${friends}.
  PRIVATE SECTION.
${defs.join('\n\n')}
ENDCLASS.

CLASS ${handlerOf(e)} IMPLEMENTATION.
${impls.join('\n\n')}
ENDCLASS.`;
  });

  return `${deferred.length ? `${deferred.join('\n')}\n\n` : ''}${classes.join('\n\n')}
`;
}

/**
 * ABAP literal used as test value for a field.
 * @param {Field} f
 */
export function sampleValue(f) {
  if (f.sample) return f.sample;
  if (f.type.kind !== 'builtin') throw new TypeError(`No sample value for ${f.element}`);
  switch (f.type.type) {
    case 'int4':
    case 'dec':
    case 'curr':
      return '1';
    case 'cuky':
      return `'EUR'`;
    case 'dats':
      return `'20260101'`;
    case 'tims':
      return `'120000'`;
    case 'numc':
      return `'${'1'.padStart(Math.min(f.type.length ?? 1, 10), '0')}'`;
    default:
      return `'X'`;
  }
}

/**
 * ABAP Unit tests for the validations: positive (all mandatory fields set) and negative
 * (all mandatory fields initial) using the released CDS test double framework.
 * @param {Model} model
 */
export function behaviorPoolTests(model) {
  const bo = model.root.names.baseView.toLowerCase();
  const tested = handledEntities(model).filter((e) => mandatoryOf(e).length);
  const doubles = [model.root, ...model.children].map((e) => `( i_for_entity = '${e.names.baseView}' )`).join(' ');
  return tested
    .map((e) => {
      const mandatory = mandatoryOf(e);
      const key = e.fields[0];
      const table = e.names.table.toLowerCase();
      const parent = e.isRoot ? '' : ` ${model.root.fields[0].column.toLowerCase()} = uuid_parent`;
      const filled = mandatory.map((f) => `${f.column.toLowerCase()} = ${sampleValue(f)}`).join(' ');
      // Concrete types per test (as in SAP's reference tests): CORRESPONDING ... MAPPING needs
      // statically known components, so no generic helper method.
      const declarations = `    DATA:
      mock_data TYPE STANDARD TABLE OF ${table} WITH EMPTY KEY,
      keys      TYPE TABLE FOR VALIDATION ${bo}\\\\${e.alias.toLowerCase()}~validatemandatory,
      failed    TYPE RESPONSE FOR FAILED LATE ${bo},
      reported  TYPE RESPONSE FOR REPORTED LATE ${bo}.`;
      const invoke = `    cds_test_environment->insert_test_data( mock_data ).
    keys = CORRESPONDING #( mock_data MAPPING ${key.element} = ${key.column.toLowerCase()} ).

    class_under_test->validatemandatory( EXPORTING keys     = keys
                                         CHANGING  failed   = failed
                                                   reported = reported ).`;
      return `"! @testing BDEF:${model.root.names.baseView}
CLASS ${testOf(e)} DEFINITION FINAL FOR TESTING
  DURATION SHORT
  RISK LEVEL HARMLESS.

  PRIVATE SECTION.
    CONSTANTS:
      uuid_1      TYPE sysuuid_x16 VALUE '00000000000000000000000000000001'${e.isRoot ? '.' : ',\n      uuid_parent TYPE sysuuid_x16 VALUE \'000000000000000000000000000000FF\'.'}

    CLASS-DATA:
      class_under_test     TYPE REF TO ${handlerOf(e)},
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

CLASS ${testOf(e)} IMPLEMENTATION.

  METHOD class_setup.
    CREATE OBJECT class_under_test FOR TESTING.
    cds_test_environment = cl_cds_test_environment=>create_for_multiple_cds(
                               VALUE #( ${doubles} ) ).
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
${declarations}

    mock_data = VALUE #( ( ${key.column.toLowerCase()} = uuid_1${parent} ${filled} ) ).
${invoke}

    cl_abap_unit_assert=>assert_initial( failed ).
  ENDMETHOD.

  METHOD mandatory_fields_missing.
${declarations}

    mock_data = VALUE #( ( ${key.column.toLowerCase()} = uuid_1${parent} ) ).
${invoke}

    cl_abap_unit_assert=>assert_equals( exp = ${mandatory.length}
                                        act = lines( failed-${e.alias.toLowerCase()} ) ).
    cl_abap_unit_assert=>assert_not_initial( reported-${e.alias.toLowerCase()} ).
  ENDMETHOD.

ENDCLASS.`;
    })
    .join('\n\n')
    .concat('\n');
}
