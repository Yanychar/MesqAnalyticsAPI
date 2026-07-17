INSERT INTO CmInvoice (
  entityKey,
  externalId,
  invoiceNumber,
  patientNumber,
  invoiceDate,
  totalExclTaxes,
  totalInclTaxes,
  totalTax,
  treatmentTotal,
  totalPackages,
  totalGiftcard,
  totalPaid,
  outstanding,
  payload,
  createdAt,
  updatedAt
) VALUES (
  'cmInvoice',
  'TEST-INV-001',
  'TEST-INV-001',
  'P-TEST-001',
  '2026-07-10',
  100.00,
  124.00,
  24.00,
  80.00,
  0.00,
  0.00,
  100.00,
  0.00,
  JSON_OBJECT('source', 'test-fixture', 'report', 'invoice-amounts'),
  NOW(),
  NOW()
);

INSERT INTO CmInvoiceMaterial (
  invoiceId,
  treatmentId,
  quantity,
  createdAt,
  updatedAt
)
SELECT
  i.id,
  t.id,
  2.00,
  NOW(),
  NOW()
FROM CmInvoice i
JOIN CmTreatment t
  ON t.externalId = 'Test Serum (BrandX; ml)'
 AND t.materialStock = 1
WHERE i.invoiceNumber = 'TEST-INV-001';
