/**
 * What: Object-level clean-core rules: SAP objects or classic enhancements in the repository
 *     (ABAP-CC-002), authorization on CDS views and behavior definitions (ABAP-SEC-001), tests and
 *     application logging in behavior pools (ABAP-TEST-001, ABAP-LOG-001) and behavior-pool naming
 *     (ABAP-NAME-001).
 * Why: Modifications, unprotected data models and untested business logic are the costliest
 *     clean-core violations; they are visible per object without a system.
 * If missing or unlinked: The ABAP gate no longer detects modifications, missing access control
 *     or untested behavior implementations.
 */

/** @typedef {import('../lint.js').RuleContext} RuleContext */

/**
 * @param {RuleContext} ctx
 */
export function checkObjects(ctx) {
  const { registry, report, isCustomer, policy } = ctx;
  /** @type {Array<{ name: string, file: string, source: string }>} */
  const views = [];
  /** @type {Set<string>} */
  const protectedViews = new Set();
  const poolPrefix = String(policy.naming?.abap?.rap?.behaviorPool ?? 'ZBP_').split('{')[0];

  for (const obj of registry.getObjects()) {
    const files = obj.getFiles();
    const firstName = files[0]?.getFilename() ?? '';
    if (firstName.startsWith('/stubs/') || firstName.startsWith('/deps/')) continue;
    const type = obj.getType();
    const name = obj.getName();
    const object = `${type} ${name}`;
    const xml = files.find((f) => f.getFilename().endsWith('.xml'));
    const fileOf = (/** @type {RegExp} */ ext) => files.find((f) => ext.test(f.getFilename()));
    const loc = (/** @type {any} */ f) => ({ file: (f ?? files[0]).getFilename().replace(/^\//, '') });

    // ABAP-CC-002: SAP objects in the repository are modifications; classic enhancements are not allowed.
    if (type !== 'DEVC' && !isCustomer(name)) {
      report('ABAP-CC-002', `${object} is not in the customer namespace: changing SAP objects is a modification.`, { object, location: loc(xml) });
    }
    if (type === 'ENHO' && xml && /<TOOL>HOOK_IMPL<\/TOOL>/.test(xml.getRaw())) {
      report('ABAP-CC-002', `${object} is a classic (implicit/explicit) enhancement; use a released BAdI or extension point.`, { object, location: loc(xml) });
    }

    if (type === 'DDLS') {
      const file = fileOf(/\.(asddls|acds)$/);
      const source = file?.getRaw() ?? '';
      if (/define\s+(root\s+)?view\b/i.test(source)) views.push({ name: name.toUpperCase(), file: loc(file).file, source });
    }
    if (type === 'DCLS') {
      const source = fileOf(/\.asdcls$/)?.getRaw() ?? '';
      for (const m of source.matchAll(/grant\s+select\s+on\s+([\w/]+)/gi)) protectedViews.add(m[1].toUpperCase());
    }

    if (type === 'BDEF') {
      const file = fileOf(/\.asbdef$/);
      const source = stripComments(file?.getRaw() ?? '');
      if (/^\s*(managed|unmanaged)\b/i.test(source)) {
        for (const m of source.matchAll(/define\s+behavior\s+for\s+([\w/]+)([^{]*)\{/gi)) {
          if (!/authorization\s+(master|dependent)/i.test(m[2])) {
            report('ABAP-SEC-001', `Behavior for ${m[1]} has no authorization master or authorization dependent clause.`, {
              object: `${object}#${m[1].toUpperCase()}`,
              location: loc(file),
            });
          }
        }
      }
    }

    if (type === 'CLAS') {
      const main = fileOf(/\.clas\.abap$/);
      if (main && /FOR\s+BEHAVIOR\s+OF/i.test(main.getRaw())) {
        const all = files.map((f) => f.getRaw()).join('\n');
        const tests = fileOf(/\.clas\.testclasses\.abap$/);
        if (!tests || !/FOR\s+TESTING/i.test(tests.getRaw())) {
          report('ABAP-TEST-001', `Behavior pool ${name} has no ABAP Unit test class.`, { object, location: loc(main) });
        }
        if (!/\b(cl_bali_log|if_bali_\w+)\b/i.test(all)) {
          report('ABAP-LOG-001', `Behavior pool ${name} does not write to the application log (CL_BALI_LOG).`, { object, location: loc(main) });
        }
        if (!name.toUpperCase().startsWith(poolPrefix.toUpperCase())) {
          report('ABAP-NAME-001', `Behavior pool ${name} does not start with ${poolPrefix} (policy/naming.yaml).`, { object, location: loc(main) });
        }
      }
    }
  }

  for (const v of views) {
    const check = /@AccessControl\.authorizationCheck\s*:\s*#(\w+)/i.exec(v.source)?.[1]?.toUpperCase();
    if (check !== 'CHECK') {
      report('ABAP-SEC-001', `CDS view ${v.name} has authorizationCheck ${check ? `#${check}` : 'missing'}; use #CHECK with an access control.`, {
        object: `DDLS ${v.name}`,
        location: { file: v.file },
      });
    } else if (!protectedViews.has(v.name)) {
      report('ABAP-SEC-001', `CDS view ${v.name} declares #CHECK but no access control (DCL) grants select on it.`, {
        object: `DDLS ${v.name}#dcl`,
        location: { file: v.file },
      });
    }
  }
}

/** @param {string} source */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
