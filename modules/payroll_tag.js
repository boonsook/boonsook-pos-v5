// Phase 489 (audit S-2) — exact-boundary match for the "#payroll-{id}" salary-expense tag.
//
// Why: _deletePayroll reversed the linked salary expense with a blind
//   DELETE expenses WHERE note ilike %#payroll-{id}%
// which is a SUBSTRING match → deleting payroll id=5 also matched #payroll-50, #payroll-500, …
// i.e. it could wipe OTHER employees' salary expenses (real money-data loss). The duplicate
// check on create had the same flaw (false "already exists" → a missing salary expense).
//
// This matches the tag only when {id} is NOT followed by another digit, so #payroll-5 ≠
// #payroll-50. Position-independent (does not assume the tag is at the end of the note).
// Pure — used to filter fetched candidates client-side before deleting by exact id.
export function payrollTagMatches(note, id) {
  const idStr = String(id == null ? "" : id);
  if (!idStr) return false;
  const escaped = idStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");  // defensive (ids are numeric, but never trust)
  return new RegExp("#payroll-" + escaped + "(?![0-9])").test(String(note == null ? "" : note));
}
