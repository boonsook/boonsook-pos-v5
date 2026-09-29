import assert from 'node:assert/strict';

// Strip ONLY the reviewed metadata insertion, then compare the entire original
// financial/conversion body against its historical hash. Missing/duplicate/
// altered insertions fail here rather than weakening the old money contract.
const insertions = {
  saveQuotationFull: "    // Freeze presentation only on first INSERT. PATCH never replaces the snapshot.\n    if (!_editingId) payload.document_template_snapshot = createDocumentTemplateSnapshot(_ctx.state.storeInfo, 'quotation');\n",
  convertToDeliveryInvoice: "    // DI is a NEW document: use current DI defaults, not the source QT template.\n    invoicePayload.document_template_snapshot = createDocumentTemplateSnapshot(_ctx.state.storeInfo, 'delivery');\n",
  convertToReceipt: "    receiptPayload.document_template_snapshot = createDocumentTemplateSnapshot(_ctx.state.storeInfo, 'receipt');\n",
};
export function withoutPhase639SnapshotInsertion(source, name, baseline = false) {
  if (baseline) return source;
  const insertion = insertions[name];
  assert.ok(insertion, 'known writer only');
  assert.equal(source.split(insertion).length, 2, name + ': exact snapshot insertion once');
  return source.replace(insertion, '');
}
