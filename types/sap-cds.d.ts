/**
 * What: Ambient module declaration that marks @sap/cds as untyped for the type checker.
 * Why: @sap/cds ships without bundled type declarations; without this, strict type checking
 *     rejects every import of it.
 * If missing or unlinked: npm run typecheck fails with TS7016 in cap-policy-lint (and any package
 *     importing @sap/cds).
 */
// @sap/cds ships no bundled type declarations; treat it as untyped at the boundary.
declare module '@sap/cds';
