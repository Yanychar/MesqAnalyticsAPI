INSERT INTO ClinicmindsSyncRun (
  entityKey,
  operationId,
  requestPath,
  requestParams,
  startedAt,
  completedAt,
  status,
  fetchedCount,
  storedCount
) VALUES
  (
    'cmPatient',
    'getPatients',
    '/api/analytics/patients?format=json',
    JSON_OBJECT('format', 'json'),
    NOW(),
    NOW(),
    'SUCCEEDED',
    1,
    1
  ),
  (
    'cmMaterialTreatment',
    'getTreatmentMaterialStock',
    '/api/analytics/treatment-material-stock?format=json&location_id=4422',
    JSON_OBJECT('format', 'json', 'location_id', 4422),
    NOW(),
    NOW(),
    'SUCCEEDED',
    1,
    1
  );

INSERT INTO ClinicmindsRawRecord (
  syncRunId,
  entityKey,
  externalId,
  stagingStatus,
  rowIndex,
  payload,
  fetchedAt
)
SELECT
  id,
  'cmPatient',
  'P-TEST-001',
  'STAGING_NEEDED',
  1,
  JSON_OBJECT(
    'Patient number', 'P-TEST-001',
    'National identification number', '010101-123X',
    'Sex', 'Female',
    'Initials', 'JT',
    'First name', 'Jane',
    'Last name', 'Tester',
    'Date of birth', '1990-01-01',
    'Email address', 'jane.tester@example.com',
    'Phone number', '0400000001',
    'Mobile number', '0400000002',
    'Registered', '2026-07-01'
  ),
  NOW()
FROM ClinicmindsSyncRun
WHERE entityKey = 'cmPatient'
LIMIT 1;

INSERT INTO ClinicmindsRawRecord (
  syncRunId,
  entityKey,
  externalId,
  stagingStatus,
  rowIndex,
  payload,
  fetchedAt
)
SELECT
  id,
  'cmMaterialTreatment',
  'Test Serum (BrandX; ml)',
  'STAGING_NEEDED',
  1,
  JSON_OBJECT(
    'Treatment', 'Test Serum',
    'Brand', 'BrandX',
    'Supplier', 'Fixture Supplier',
    'Article number', 'FIX-001',
    'Unit', 'ml',
    'Sales price (incl. taxes)', '24.80',
    'Purchase price', '10.00',
    'Stock', '50',
    'Minimum stock', '5',
    'Stock value', '500.00'
  ),
  NOW()
FROM ClinicmindsSyncRun
WHERE entityKey = 'cmMaterialTreatment'
LIMIT 1;
