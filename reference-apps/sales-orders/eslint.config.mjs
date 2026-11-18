/**
 * What: ESLint configuration from cds init: CAP recommended rules plus @sap/eslint-plugin-cds
 *     model checks.
 * Why: Catches JavaScript and CDS modelling mistakes before the policy gate and tests run.
 * If missing or unlinked: npm run lint fails with "no configuration found" and code-quality checks
 *     stop.
 */

import cds from '@sap/cds/eslint.config.mjs'
import cdsPlugin from '@sap/eslint-plugin-cds'

export default [...cds.recommended, cdsPlugin.configs.recommended]
