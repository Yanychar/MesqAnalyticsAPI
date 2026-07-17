SELECT 'invoice_rows_in_range' AS check_name, '1' AS expected, CAST(COUNT(*) AS CHAR) AS actual
FROM CmInvoice
WHERE invoiceDate BETWEEN '2026-07-01' AND '2026-07-31'
UNION ALL
SELECT 'invoice_total_vat_excl', '100.00', CAST(CAST(COALESCE(SUM(totalExclTaxes), 0.00) AS DECIMAL(12,2)) AS CHAR)
FROM CmInvoice
WHERE invoiceDate BETWEEN '2026-07-01' AND '2026-07-31'
UNION ALL
SELECT 'invoice_materials_vat_excl', '20.00', CAST(CAST(COALESCE(SUM(im.quantity * t.purchasePrice), 0.00) AS DECIMAL(12,2)) AS CHAR)
FROM CmInvoice i
JOIN CmInvoiceMaterial im ON im.invoiceId = i.id
JOIN CmTreatment t ON t.id = im.treatmentId
WHERE i.invoiceDate BETWEEN '2026-07-01' AND '2026-07-31'
UNION ALL
SELECT 'invoice_remaining_vat_excl', '80.00', CAST(CAST(COALESCE(SUM(i.totalExclTaxes - material_totals.material_cost), 0.00) AS DECIMAL(12,2)) AS CHAR)
FROM CmInvoice i
JOIN (
  SELECT
    im.invoiceId,
    SUM(im.quantity * t.purchasePrice) AS material_cost
  FROM CmInvoiceMaterial im
  JOIN CmTreatment t ON t.id = im.treatmentId
  GROUP BY im.invoiceId
) material_totals ON material_totals.invoiceId = i.id
WHERE i.invoiceDate BETWEEN '2026-07-01' AND '2026-07-31'
UNION ALL
SELECT 'invoice_total_vat', '24.00', CAST(CAST(COALESCE(SUM(totalTax), 0.00) AS DECIMAL(12,2)) AS CHAR)
FROM CmInvoice
WHERE invoiceDate BETWEEN '2026-07-01' AND '2026-07-31'
UNION ALL
SELECT 'invoice_total_paid', '100.00', CAST(CAST(COALESCE(SUM(totalPaid), 0.00) AS DECIMAL(12,2)) AS CHAR)
FROM CmInvoice
WHERE invoiceDate BETWEEN '2026-07-01' AND '2026-07-31';
