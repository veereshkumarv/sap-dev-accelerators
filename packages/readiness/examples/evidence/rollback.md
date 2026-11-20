<!--
What: Rollback / roll-forward procedure for the example sales-orders release.
Why: RDY-ROLLBACK requires a documented, non-empty procedure before a PROD deployment; this is the
    template teams copy.
If missing or unlinked: RDY-ROLLBACK fails ("not found") and the PROD example turns Amber.
-->

# Rollback procedure - sales-orders 1.0.0 (CHG0012345)

**Decision owner:** release manager on duty. **Time box:** start rollback if smoke tests fail
within 30 minutes after deployment.

## Application (Cloud Foundry, MTA)

1. `cf mta-ops` - confirm no deployment is still running.
2. Redeploy the previous archive from the artefact store:
   `cf deploy sales-orders_0.9.0.mtar -f --strategy blue-green`.
3. Run the smoke collection: `newman run odata-tests.postman_collection.json -e prod.json`.

## Database (HANA HDI)

This release declares no destructive change (`dbMigration.destructive: false`), so the previous
version runs on the new schema. No data restore is needed; roll forward fixes are preferred.

## Communication

Update the change record CHG0012345 with the outcome and inform the consuming teams listed in
`catalog-info.yaml`.
