/**
 * What: Orchestrates RAP generation: normalises the model, produces every abapGit file of the
 *     business object (sources + XML metadata), adds headers, README and docs/files.md, and writes
 *     the result without overwriting existing files unless forced.
 * Why: One deterministic pipeline turns a reviewed YAML model into a complete, clean-core RAP
 *     business object that is imported with abapGit/gCTS and reviewed as a normal pull request.
 * If missing or unlinked: rap-scaffold has nothing to run; CLI and programmatic API fail.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as xml from './abapgit.js';
import { XML_NO_INLINE, renderFilesDoc, withHeader } from './catalog.js';
import { activeTableFields, draftTableFields } from './ddic.js';
import * as emit from './emit.js';
import { normalizeModel } from './model.js';

/**
 * @typedef {import('./model.js').Model} Model
 * @typedef {import('./model.js').Entity} Entity
 * @typedef {import('./catalog.js').Description} Description
 * @typedef {{ path: string, content: string } & Description} GeneratedFile
 */

export class OverwriteError extends Error {
  /** @param {string[]} files */
  constructor(files) {
    super(`Refusing to overwrite existing files (use --force): ${files.join(', ')}`);
    this.name = 'OverwriteError';
    this.files = files;
  }
}

/** @param {string} objectName */
const base = (objectName) => `src/${objectName.toLowerCase()}`;

/**
 * Generates all files for a model. Pure: no file system access.
 * @param {any} rawModel   parsed YAML/JSON model
 * @param {any} naming     policy naming section
 * @returns {{ model: Model, files: GeneratedFile[] }}
 */
export function scaffold(rawModel, naming) {
  const model = normalizeModel(rawModel, naming);
  const { root, draft } = model;
  const entities = [root, ...model.children];
  const bo = root.names.baseView;
  /** @type {GeneratedFile[]} */
  const files = [];
  /**
   * @param {string} p
   * @param {string} content
   * @param {Description} d
   */
  const add = (p, content, d) => files.push({ path: p, ...d, content: withHeader(d, p, content) });
  const meta = (/** @type {string} */ what, /** @type {string} */ missing) => ({ what, why: 'abapGit object metadata required to create the object on import.', missing, noInline: XML_NO_INLINE });

  add('.abapgit.xml', xml.repositoryXml(), meta('abapGit repository descriptor (starting folder /src/, prefix folder logic, master language E).', 'abapGit does not recognise the repository and imports nothing.'));
  add('src/package.devc.xml', xml.devcXml(model.description), meta(`Package ${model.package}: ${model.description}.`, 'abapGit cannot create the target package; objects have no package.'));

  for (const e of entities) {
    const who = `${e.label} (${e.names.baseView})`;
    add(`${base(e.names.table)}.tabl.xml`, xml.tablXml({ name: e.names.table, description: `${e.label} - active data`, draft: false, fields: activeTableFields(e) }), {
      what: `Database table ${e.names.table}: active persistence of ${who} with UUID key, business and administrative fields.`,
      why: 'Persistent table of the managed RAP business object; field names are mapped in the behavior definition.',
      missing: `${e.names.baseView} and the behavior definition reference a non-existing table; activation fails.`,
      noInline: XML_NO_INLINE,
    });
    if (draft) {
      add(`${base(e.names.draftTable)}.tabl.xml`, xml.tablXml({ name: e.names.draftTable, description: `${e.label} - draft data`, draft: true, fields: draftTableFields(e) }), {
        what: `Draft table ${e.names.draftTable} of ${who} with the draft administration include.`,
        why: 'RAP draft handling stores unsaved user changes here (fields named after the CDS elements).',
        missing: 'The behavior definition "draft table" clause fails; draft-enabled Fiori apps cannot save drafts.',
        noInline: XML_NO_INLINE,
      });
    }
    add(`${base(e.names.baseView)}.ddls.asddls`, emit.baseView(model, e), {
      what: `CDS base view entity ${e.names.baseView} for ${e.label} (${e.isRoot ? 'root' : 'child'} of the business object), with #CHECK access control.`,
      why: 'Data model layer of the RAP business object; the behavior definition and projections build on it.',
      missing: 'The business object has no data model; behavior definition, projection and service fail to activate.',
    });
    add(`${base(e.names.baseView)}.ddls.xml`, xml.ddlsXml(e.names.baseView, e.label, 'W'), meta(`Metadata of CDS view entity ${e.names.baseView}.`, `abapGit cannot create ${e.names.baseView}.`));
    add(`${base(e.names.projectionView)}.ddls.asddls`, emit.projectionView(model, e), {
      what: `CDS projection view ${e.names.projectionView}: service-specific projection of ${e.names.baseView}.`,
      why: 'Decouples the exposed UI service from the data model (provider contract transactional_query).',
      missing: 'The service definition exposes a non-existing entity; the OData service cannot be activated.',
    });
    add(`${base(e.names.projectionView)}.ddls.xml`, xml.ddlsXml(e.names.projectionView, `${e.label} (projection)`, 'P'), meta(`Metadata of projection view ${e.names.projectionView}.`, `abapGit cannot create ${e.names.projectionView}.`));
    add(`${base(e.names.projectionView)}.ddlx.asddlxs`, emit.metadataExtension(model, e), {
      what: `UI metadata extension for ${e.names.projectionView}: Fiori elements list, object page and facets.`,
      why: 'Keeps UI annotations out of the data model and lets the customer layer adjust the UI.',
      missing: 'The Fiori elements preview shows no columns or facets; the service itself still works.',
    });
    add(`${base(e.names.projectionView)}.ddlx.xml`, xml.ddlxXml(e.names.projectionView, `UI annotations for ${e.label}`), meta(`Metadata of metadata extension ${e.names.projectionView}.`, 'abapGit cannot create the metadata extension.'));
    add(`${base(e.names.accessControl)}.dcls.asdcls`, emit.baseAccessControl(model, e), {
      what: `Access control for ${e.names.baseView}: read access requires authorization object ${model.authorizationObject} with ACTVT 03.`,
      why: 'Secure by default (rule ABAP-SEC-001): rows are only visible to users with the authorization.',
      missing: `${e.names.baseView} declares #CHECK without a role: activation warns and all users would see no data or, if changed to #NOT_REQUIRED, all data.`,
    });
    add(`${base(e.names.accessControl)}.dcls.xml`, xml.dclsXml(e.names.accessControl, `Access control for ${e.names.baseView}`), meta(`Metadata of access control ${e.names.accessControl}.`, 'abapGit cannot create the access control.'));
    add(`${base(e.names.projectionAccessControl)}.dcls.asdcls`, emit.projectionAccessControl(e), {
      what: `Access control for ${e.names.projectionView}, inheriting the conditions of ${e.names.baseView}.`,
      why: 'Projections must enforce the same authorization as the base view.',
      missing: 'The projection is not protected by an access control; ABAP-SEC-001 is violated.',
    });
    add(`${base(e.names.projectionAccessControl)}.dcls.xml`, xml.dclsXml(e.names.projectionAccessControl, `Access control for ${e.names.projectionView}`), meta(`Metadata of access control ${e.names.projectionAccessControl}.`, 'abapGit cannot create the access control.'));
  }

  add(`${base(bo)}.bdef.asbdef`, emit.baseBehavior(model), {
    what: `Behavior definition of ${bo}: managed, strict(2)${draft ? ', draft-enabled' : ''}, global authorization, mandatory-field validations, field mappings.`,
    why: 'Defines the transactional behavior of the business object (create/update/delete, locks, ETags, validations).',
    missing: 'The business object is read-only CDS; projection behavior, service and Fiori app cannot modify data.',
  });
  add(`${base(bo)}.bdef.xml`, xml.bdefXml(bo, `Behavior for ${bo}`), meta(`Metadata of behavior definition ${bo}.`, 'abapGit cannot create the behavior definition.'));
  add(`${base(root.names.projectionView)}.bdef.asbdef`, emit.projectionBehavior(model), {
    what: `Projection behavior definition of ${root.names.projectionView}: operations exposed to the UI service.`,
    why: 'Only operations listed here are available to the service consumer.',
    missing: 'The UI service is read-only; create, update, delete and draft actions are not exposed.',
  });
  add(`${base(root.names.projectionView)}.bdef.xml`, xml.bdefXml(root.names.projectionView, `Projection behavior for ${root.names.projectionView}`), meta(`Metadata of projection behavior definition ${root.names.projectionView}.`, 'abapGit cannot create the projection behavior definition.'));

  const pool = root.names.behaviorPool;
  add(`${base(pool)}.clas.abap`, emit.behaviorPoolMain(model), {
    what: `Behavior pool ${pool} for ${bo} (global class shell; logic is in the local types).`,
    why: 'Required container for the behavior implementation referenced by the behavior definition.',
    missing: 'The behavior definition references a missing class; activation fails.',
  });
  add(`${base(pool)}.clas.locals_imp.abap`, emit.behaviorPoolLocals(model), {
    what: `Behavior handlers of ${bo}: global authorization via AUTHORITY-CHECK on ${model.authorizationObject} and mandatory-field validations.`,
    why: 'Implements secure-by-default authorization and data quality checks with released APIs only (ABAP Cloud).',
    missing: 'Authorization and validations are not implemented; the behavior definition fails to activate.',
  });
  add(`${base(pool)}.clas.testclasses.abap`, emit.behaviorPoolTests(model), {
    what: `ABAP Unit tests for the validations of ${bo} (positive and negative case) using the CDS test double framework.`,
    why: 'Every behavior implementation needs tests including a negative case (rule ABAP-TEST-001).',
    missing: 'Validations are untested and the clean-core gate reports ABAP-TEST-001.',
  });
  add(`${base(pool)}.clas.xml`, xml.clasXml(pool, `Behavior implementation for ${bo}`, bo), meta(`Metadata of behavior pool ${pool}.`, 'abapGit cannot create the behavior pool.'));

  const srvd = root.names.serviceDefinition;
  add(`${base(srvd)}.srvd.srvdsrv`, emit.serviceDefinition(model), {
    what: `Service definition ${srvd}: exposes ${entities.map((e) => e.names.projectionView).join(', ')}.`,
    why: 'Defines the scope of the OData service bound by the service binding.',
    missing: 'The service binding has nothing to expose; no OData service exists.',
  });
  add(`${base(srvd)}.srvd.xml`, xml.srvdXml(srvd, model.description), meta(`Metadata of service definition ${srvd}.`, 'abapGit cannot create the service definition.'));
  const srvb = root.names.serviceBinding;
  add(`${base(srvb)}.srvb.xml`, xml.srvbXml(srvb, srvd, `${model.description} (OData V4 UI)`), {
    what: `Service binding ${srvb}: OData V4 UI binding of ${srvd}, imported unpublished.`,
    why: 'Makes the service reachable as OData V4 for Fiori elements after explicit publishing in ADT.',
    missing: 'The service cannot be published or previewed.',
    noInline: XML_NO_INLINE,
  });

  add('README.md', readme(model), {
    what: `Generated RAP business object ${bo} (${model.description}) in abapGit format.`,
    why: 'Explains how to import, activate, publish and verify the generated objects.',
    missing: 'Importers do not know the prerequisites (authorization object, package) or the activation order.',
  });
  const filesDoc = { path: 'docs/files.md', what: 'Catalog of all generated files with What / Why / If missing.', why: 'Documents files that cannot carry an inline header (abapGit XML).', missing: 'XML metadata files are undocumented.' };
  add('docs/files.md', renderFilesDoc([...files, filesDoc], bo), filesDoc);

  // Code-point order: localeCompare depends on the machine locale and would break determinism.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { model, files };
}

/** @param {Model} model */
function readme(model) {
  const { root } = model;
  return `# ${root.names.baseView} - ${model.description}

Generated by \`rap-scaffold\` (SAP dev accelerators). ABAP for Cloud Development, released APIs only.

## Prerequisites

- Authorization object **${model.authorizationObject}** with field \`ACTVT\` exists (create it in ADT if needed)
  and users get it via a business role / role collection.
- Package **${model.package}** (created by abapGit from \`src/package.devc.xml\`).

## Import and activate

1. abapGit (ADT plug-in or gCTS): link this repository to package ${model.package} and pull.
2. Activate all objects (mass activation).
3. Open service binding **${root.names.serviceBinding}** in ADT and choose *Publish*.
4. Run ABAP Unit on **${root.names.behaviorPool}** and ATC with the clean-core check variant.

## Objects

| Purpose | Object |
|---------|--------|
| Tables | ${[root, ...model.children].map((e) => `\`${e.names.table}\`${model.draft ? `, \`${e.names.draftTable}\`` : ''}`).join(', ')} |
| Base views | ${[root, ...model.children].map((e) => `\`${e.names.baseView}\``).join(', ')} |
| Projections | ${[root, ...model.children].map((e) => `\`${e.names.projectionView}\``).join(', ')} |
| Behavior | \`${root.names.baseView}\` (base), \`${root.names.projectionView}\` (projection), pool \`${root.names.behaviorPool}\` |
| Service | \`${root.names.serviceDefinition}\`, binding \`${root.names.serviceBinding}\` (OData V4 UI) |

See \`docs/files.md\` for every file.
`;
}

/**
 * Writes generated files below a directory. Refuses to overwrite unless force is set.
 * @param {GeneratedFile[]} files
 * @param {string} outDir
 * @param {{ force?: boolean }} [options]
 */
export async function writeFiles(files, outDir, { force = false } = {}) {
  if (!force) {
    const existing = [];
    for (const f of files) {
      try {
        await access(path.join(outDir, f.path));
        existing.push(f.path);
      } catch {
        // does not exist - fine
      }
    }
    if (existing.length) throw new OverwriteError(existing);
  }
  for (const f of files) {
    const target = path.join(outDir, f.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, f.content);
  }
}
