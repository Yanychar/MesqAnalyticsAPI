-- Quick invoice totals check helper
-- Replace the invoice number in the WHERE clause when needed.

SELECT
  i.invoiceNumber,
  i.invoiceDate,
  i.discountExclTaxes,
  i.totalExclTaxes,
  i.totalTreatments,
  i.totalProducts,
  i.totalPackages,
  i.totalGiftcard,
  i.totalTax,
  i.totalPaid,
  (
    SELECT COALESCE(SUM(it.amount), 0)
    FROM CmInvoiceTreatment it
    WHERE it.invoiceId = i.id
  ) AS summedTreatmentRows,
  (
    SELECT COALESCE(SUM(ip.amount), 0)
    FROM CmInvoicePackage ip
    WHERE ip.invoiceId = i.id
  ) AS summedPackageRows,
  (
    SELECT COALESCE(SUM(pr.amount), 0)
    FROM CmInvoiceProduct pr
    WHERE pr.invoiceId = i.id
  ) AS summedProductRows
FROM CmInvoice i
WHERE i.invoiceNumber = '260100550';
