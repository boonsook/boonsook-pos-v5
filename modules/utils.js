// Shared utilities — Phase 51 (1 พ.ค. 2026)
// Canonical escHtml: null-safe, escapes 5 HTML special chars (&, <, >, ", ')
// Dedupes ~30 local copies across modules.
export function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}
