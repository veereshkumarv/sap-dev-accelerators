/**
 * What: Serializes ABAP repository objects into abapGit XML metadata (DEVC, TABL, DDLS, DDLX,
 *     DCLS, BDEF, SRVD, SRVB, CLAS) and the .abapgit.xml repository descriptor.
 * Why: Formats mirror SAP's abapGit-serialized RAP reference scenario (abap-platform-refscen-flight,
 *     branch ABAP-platform-cloud), so generated repositories can be pulled with abapGit/gCTS.
 * If missing or unlinked: No XML metadata is produced and abapGit cannot import the generated
 *     objects.
 */

/** abapGit writes a UTF-8 byte order mark; matching it avoids a diff on the first re-serialization. */
const BOM = '\uFEFF';

/** @param {string} s */
export function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Renders nested [tag, value] pairs. Values are strings (escaped) or nested arrays.
 * @typedef {[string, string | Node[]]} Node
 * @param {Node[]} list
 * @param {number} indent
 * @returns {string}
 */
export function renderNodes(list, indent) {
  const pad = ' '.repeat(indent);
  return list
    .map(([tag, value]) => (Array.isArray(value) ? `${pad}<${tag}>\n${renderNodes(value, indent + 1)}\n${pad}</${tag}>` : `${pad}<${tag}>${esc(value)}</${tag}>`))
    .join('\n');
}

/**
 * @param {string} serializer e.g. LCL_OBJECT_DDLS
 * @param {Node[]} values
 */
function abapGit(serializer, values) {
  return `${BOM}<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
${renderNodes(values, 3)}
  </asx:values>
 </asx:abap>
</abapGit>
`;
}

export function repositoryXml() {
  return `${BOM}<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA>
   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>
   <STARTING_FOLDER>/src/</STARTING_FOLDER>
   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
  </DATA>
 </asx:values>
</asx:abap>
`;
}

/** @param {string} description */
export function devcXml(description) {
  return abapGit('LCL_OBJECT_DEVC', [['DEVC', [['CTEXT', description]]]]);
}

/**
 * @param {{ name: string, description: string, draft: boolean, fields: Node[][] }} table
 */
export function tablXml({ name, description, draft, fields }) {
  return abapGit('LCL_OBJECT_TABL', [
    [
      'DD02V',
      [
        ['TABNAME', name],
        ['DDLANGUAGE', 'E'],
        ['TABCLASS', 'TRANSP'],
        ['CLIDEP', 'X'],
        ...(draft ? /** @type {Node[]} */ ([['LANGDEP', 'X']]) : []),
        ['DDTEXT', description],
        ['MASTERLANG', 'E'],
        ['CONTFLAG', 'A'],
        ['EXCLASS', draft ? '4' : '1'],
      ],
    ],
    [
      'DD09L',
      [
        ['TABNAME', name],
        ['AS4LOCAL', 'A'],
        ['TABKAT', draft ? '4' : '0'],
        ['TABART', draft ? 'APPL1' : 'APPL0'],
        ['BUFALLOW', 'N'],
      ],
    ],
    ['DD03P_TABLE', fields.map((f) => /** @type {Node} */ (['DD03P', f]))],
  ]);
}

/**
 * @param {string} name
 * @param {string} text
 * @param {'W' | 'P'} sourceType  W = view entity, P = projection view
 */
export function ddlsXml(name, text, sourceType) {
  return abapGit('LCL_OBJECT_DDLS', [
    [
      'DDLS',
      [
        ['DDLNAME', name],
        ['DDLANGUAGE', 'E'],
        ['DDTEXT', text],
        ['SOURCE_TYPE', sourceType],
      ],
    ],
  ]);
}

/**
 * @param {string} name
 * @param {string} description
 */
export function ddlxXml(name, description) {
  return abapGit('LCL_OBJECT_DDLX', [
    [
      'DDLX',
      [
        [
          'METADATA',
          [
            ['NAME', name],
            ['DESCRIPTION', description],
            ['MASTER_LANGUAGE', 'EN'],
          ],
        ],
      ],
    ],
  ]);
}

/**
 * @param {string} name
 * @param {string} text
 */
export function dclsXml(name, text) {
  return abapGit('LCL_OBJECT_DCLS', [
    [
      'DCLS',
      [
        ['DCLNAME', name],
        ['DCLLANGUAGE', 'E'],
        ['DDTEXT', text],
      ],
    ],
  ]);
}

/** @param {string} name */
function sourceUri(name) {
  return `./${encodeURIComponent(name.toLowerCase())}/source/main`;
}

/**
 * @param {string} name
 * @param {string} description
 */
export function bdefXml(name, description) {
  return abapGit('LCL_OBJECT_BDEF', [
    [
      'BDEF',
      [
        ['NAME', name],
        ['TYPE', 'BDEF/BDO'],
        ['DESCRIPTION', description],
        ['DESCRIPTION_TEXT_LIMIT', '60'],
        ['LANGUAGE', 'EN'],
        ['MASTER_LANGUAGE', 'EN'],
        ['ABAP_LANGU_VERSION', 'X'],
        ['SOURCE_URI', sourceUri(name)],
        ['SOURCE_TYPE', 'ABAP_SOURCE'],
        ['SOURCE_FIXED_POINT_ARITHMETIC', 'true'],
        ['SOURCE_UNICODE_CHECKS_ACTIVE', 'true'],
      ],
    ],
  ]);
}

/**
 * @param {string} name
 * @param {string} description
 */
export function srvdXml(name, description) {
  return abapGit('LCL_OBJECT_SRVD', [
    [
      'SRVD',
      [
        ['NAME', name],
        ['TYPE', 'SRVD/SRV'],
        ['DESCRIPTION', description],
        ['LANGUAGE', 'EN'],
        ['MASTER_LANGUAGE', 'EN'],
        ['SOURCE_URI', sourceUri(name)],
        ['SOURCE_TYPE', 'ABAP_SOURCE'],
        ['SOURCE_ORIGIN_DESCRIPTION', 'ABAP Development Tools'],
        ['SRVD_SOURCE_TYPE', 'S'],
        ['SRVD_SOURCE_TYPE_DESC', 'Definition'],
      ],
    ],
  ]);
}

/**
 * OData V4 UI service binding. Created unpublished: publishing is an explicit step in ADT after
 * review (and requires the binding to activate cleanly in the target system).
 * @param {string} name
 * @param {string} serviceDefinition
 * @param {string} description
 */
export function srvbXml(name, serviceDefinition, description) {
  return abapGit('LCL_OBJECT_SRVB', [
    [
      'SRVB',
      [
        [
          'METADATA',
          [
            ['NAME', name],
            ['TYPE', 'SRVB/SVB'],
            ['DESCRIPTION', description],
          ],
        ],
        [
          'CONTENT',
          [
            ['BIND_TYPE_IMPL', [['NAME', name]]],
            ['BIND_TYPE', 'ODATA'],
            ['BIND_TYPE_VERSION', 'V4'],
            [
              'SERVICES',
              [
                [
                  'item',
                  [
                    ['SERVICE_NAME', serviceDefinition],
                    [
                      'SERVICE_CONTENT',
                      [
                        [
                          'item',
                          [
                            ['SERVICE_VERSION', '0001'],
                            ['RELEASE_STATE', 'NOT_RELEASED'],
                            [
                              'SRVD_REF',
                              [
                                ['URI', `/sap/bc/adt/ddic/srvd/sources/${encodeURIComponent(serviceDefinition.toLowerCase())}`],
                                ['TYPE', 'SRVD/SRV'],
                                ['NAME', serviceDefinition],
                              ],
                            ],
                            ['BIND_TYPE_DATA', [['CONTENT', [['ENCODING', 'base64']]]]],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
        ['CONTRACT', 'C1'],
        ['RELEASE_SUPPORTED', 'true'],
        ['PUBLISHED', 'false'],
        ['BINDING_CREATED', 'true'],
        ['ALLOWED_ACTION', 'PUBLISH'],
      ],
    ],
  ]);
}

/**
 * Behavior pool (class category 06) with local types and unit tests.
 * @param {string} name
 * @param {string} description
 * @param {string} behaviorDefinition
 */
export function clasXml(name, description, behaviorDefinition) {
  return abapGit('LCL_OBJECT_CLAS', [
    [
      'VSEOCLASS',
      [
        ['CLSNAME', name],
        ['LANGU', 'E'],
        ['DESCRIPT', description],
        ['CATEGORY', '06'],
        ['STATE', '1'],
        ['CLSCCINCL', 'X'],
        ['FIXPT', 'X'],
        // 5 = ABAP for Cloud Development (as serialized in SAP's reference scenario).
        ['UNICODE', '5'],
        ['CLSDEFINT', behaviorDefinition],
        ['WITH_UNIT_TESTS', 'X'],
      ],
    ],
  ]);
}
