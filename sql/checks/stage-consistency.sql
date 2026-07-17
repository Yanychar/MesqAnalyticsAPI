SELECT 'raw_rows_total' AS check_name, '2' AS expected, CAST(COUNT(*) AS CHAR) AS actual
FROM ClinicmindsRawRecord
UNION ALL
SELECT 'raw_rows_staging_done', '2', CAST(COUNT(*) AS CHAR)
FROM ClinicmindsRawRecord
WHERE stagingStatus = 'STAGING_DONE'
UNION ALL
SELECT 'raw_rows_staging_needed', '0', CAST(COUNT(*) AS CHAR)
FROM ClinicmindsRawRecord
WHERE stagingStatus = 'STAGING_NEEDED'
UNION ALL
SELECT 'cm_patient_rows', '1', CAST(COUNT(*) AS CHAR)
FROM CmPatient
WHERE patientNumber = 'P-TEST-001'
UNION ALL
SELECT 'cm_treatment_rows', '1', CAST(COUNT(*) AS CHAR)
FROM CmTreatment
WHERE externalId = 'Test Serum (BrandX; ml)'
  AND materialStock = 1
UNION ALL
SELECT 'cm_treatment_inventory_confirmed', '1', CAST(COUNT(*) AS CHAR)
FROM CmTreatment
WHERE externalId = 'Test Serum (BrandX; ml)'
  AND materialStock = 1
  AND inventoryConfirmed = 1
  AND manualReviewNeeded = 0
UNION ALL
SELECT 'stage_run_patient_succeeded', '1', CAST(COUNT(*) AS CHAR)
FROM ClinicmindsStageRun
WHERE entityKey = 'cmPatient'
  AND status = 'SUCCEEDED'
UNION ALL
SELECT 'stage_run_material_succeeded', '1', CAST(COUNT(*) AS CHAR)
FROM ClinicmindsStageRun
WHERE entityKey = 'cmMaterialTreatment'
  AND status = 'SUCCEEDED';
