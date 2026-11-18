/**
 * What: Test helpers that build small abapGit repositories (classes, CDS views, access controls,
 *     behavior definitions, enhancements) in temporary folders, plus a released-API fixture.
 * Why: Rule tests need many tiny, precise repositories; building them in code keeps every fixture
 *     visible next to the assertion that uses it.
 * If missing or unlinked: The abap-policy-lint tests cannot create their fixtures and fail.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const wrap = (/** @type {string} */ serializer, /** @type {string} */ body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n  <asx:values>\n${body}\n  </asx:values>\n </asx:abap>\n</abapGit>\n`;

export const xml = {
  clas: (/** @type {string} */ name) =>
    wrap('LCL_OBJECT_CLAS', `   <VSEOCLASS><CLSNAME>${name}</CLSNAME><LANGU>E</LANGU><DESCRIPT>t</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>5</UNICODE></VSEOCLASS>`),
  ddls: (/** @type {string} */ name) => wrap('LCL_OBJECT_DDLS', `   <DDLS><DDLNAME>${name}</DDLNAME><DDLANGUAGE>E</DDLANGUAGE><DDTEXT>t</DDTEXT><SOURCE_TYPE>W</SOURCE_TYPE></DDLS>`),
  dcls: (/** @type {string} */ name) => wrap('LCL_OBJECT_DCLS', `   <DCLS><DCLNAME>${name}</DCLNAME><DCLLANGUAGE>E</DCLLANGUAGE><DDTEXT>t</DDTEXT></DCLS>`),
  bdef: (/** @type {string} */ name) => wrap('LCL_OBJECT_BDEF', `   <BDEF><NAME>${name}</NAME><TYPE>BDEF/BDO</TYPE><DESCRIPTION>t</DESCRIPTION><LANGUAGE>EN</LANGUAGE></BDEF>`),
  enho: (/** @type {string} */ name, /** @type {string} */ tool) => wrap('LCL_OBJECT_ENHO', `   <TOOL>${tool}</TOOL>\n   <SHORTTEXT>${name}</SHORTTEXT>`),
  repo: (/** @type {string} */ folder) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n <asx:values>\n  <DATA>\n   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>\n   <STARTING_FOLDER>${folder}</STARTING_FOLDER>\n   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>\n  </DATA>\n </asx:values>\n</asx:abap>\n`,
};

/**
 * Writes files into a new temporary repository.
 * @param {Record<string, string>} files  path -> content
 */
export async function makeRepo(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'abap-lint-'));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
  return dir;
}

/**
 * A class in abapGit format (main source + XML + optional includes).
 * @param {string} name
 * @param {string} main
 * @param {{ locals?: string, tests?: string, folder?: string }} [parts]
 */
export function clas(name, main, { locals, tests, folder = 'src' } = {}) {
  const base = `${folder}/${name.toLowerCase()}.clas`;
  return {
    [`${base}.abap`]: main,
    [`${base}.xml`]: xml.clas(name),
    ...(locals ? { [`${base}.locals_imp.abap`]: locals } : {}),
    ...(tests ? { [`${base}.testclasses.abap`]: tests } : {}),
  };
}

/** Simple class with one method body. */
export function classWith(/** @type {string} */ name, /** @type {string} */ body) {
  return clas(
    name,
    `CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS run.\nENDCLASS.\n\nCLASS ${name.toLowerCase()} IMPLEMENTATION.\n  METHOD run.\n${body}\n  ENDMETHOD.\nENDCLASS.\n`,
  );
}

/** Released-API fixture in the compact cache format. */
export const RELEASED_FIXTURE = {
  formatVersion: 1,
  source: 'fixture',
  variant: 'btp',
  objects: [
    ['CLAS', 'CL_ABAP_UNIT_ASSERT', 'CLAS', 'CL_ABAP_UNIT_ASSERT', 'released', ''],
    ['CLAS', 'CL_ABAP_BEHAVIOR_HANDLER', 'CLAS', 'CL_ABAP_BEHAVIOR_HANDLER', 'released', ''],
    ['CLAS', 'CL_BALI_LOG', 'CLAS', 'CL_BALI_LOG', 'released', ''],
    ['INTF', 'IF_BALI_LOG', 'INTF', 'IF_BALI_LOG', 'released', ''],
    ['INTF', 'IF_ABAP_BEHV', 'INTF', 'IF_ABAP_BEHV', 'released', ''],
    ['CLAS', 'CL_ABAP_CONTEXT_INFO', 'CLAS', 'CL_ABAP_CONTEXT_INFO', 'released', ''],
    ['DDLS', 'I_PRODUCT', 'CDS_STOB', 'I_PRODUCT', 'released', ''],
    ['DTEL', 'ABAP_BOOLEAN', 'DTEL', 'ABAP_BOOLEAN', 'released', ''],
    ['DOMA', 'ABAP_BOOLEAN', 'DOMA', 'ABAP_BOOLEAN', 'deprecated', ''],
    ['CLAS', 'CL_OLD_API', 'CLAS', 'CL_OLD_API', 'deprecated', 'CL_NEW_API'],
    ['CLAS', 'CL_SALV_TABLE', 'CLAS', 'CL_SALV_TABLE', 'notToBeReleased', ''],
    ['FUGR', 'SOMEFG', 'FUNC', 'Z_NOT_SAP', 'released', ''],
  ],
};
