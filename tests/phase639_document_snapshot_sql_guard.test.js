import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync(new URL('../supabase-phase639-document-template-snapshot.sql',import.meta.url),'utf8');
const clean=sql.replace(/--[^\n]*/g,'');
test('639 SQL: single atomic DO owns all DDL and notification, timeout required before entry',()=>{
  assert.match(clean,/^\s*DO \$phase639\$/);
  assert.equal((clean.match(/\bDO\s+\$/g)||[]).length,1);
  assert.doesNotMatch(clean,/\b(?:COMMIT|ROLLBACK|SET LOCAL)\b|BEGIN;/);
  assert.match(clean,/timeout_ms < 1 OR timeout_ms > 30000/);
  assert.match(clean,/set_config\('lock_timeout','5s',true\)/);
  assert.doesNotMatch(clean,/set_config\('statement_timeout'/);
  const end=clean.indexOf('$phase639$;',clean.indexOf('DO ')+3);
  for(const action of ['CREATE FUNCTION','REVOKE ALL','ADD COLUMN','ADD CONSTRAINT','CREATE TRIGGER',"pg_notify('pgrst','reload schema')"]) {
    assert.ok(clean.indexOf(action)>clean.indexOf('timeout_ms < 1'));
    assert.ok(clean.indexOf(action)<end);
  }
});
test('639 SQL: no document UPDATE/backfill, financial helper, RLS or table grant modification',()=>{
  assert.doesNotMatch(clean,/\b(?:INSERT INTO|DELETE FROM|UPDATE public\.|UPDATE quotations|UPDATE receipts|UPDATE delivery_invoices|DROP|DISABLE TRIGGER)\b/i);
  assert.doesNotMatch(clean,/\b(?:next_doc_number|assign_quotation_no|assign_delivery_invoice_no|assign_receipt_no|CREATE POLICY|ALTER POLICY|ROW LEVEL SECURITY|GRANT)\b/i);
  assert.match(clean,/ADD COLUMN document_template_snapshot jsonb NOT NULL DEFAULT %L::jsonb/);
});
test('639 SQL: fail closed on unknown state; settings row locked through cutover',()=>{
  assert.match(clean,/INTO STRICT info FROM public.app_settings WHERE key = 'store_info' FOR SHARE/);
  assert.match(clean,/info \? 'docTemplatesV1'/);
  assert.match(clean,/column already exists on %; inspect, do not rerun/);
  assert.match(clean,/already applied or function-name collision; do not rerun/);
});
test('639 SQL: constraints reject missing JSON keys, immutable invoker trigger, revoked EXECUTE',()=>{
  assert.match(clean,/CHECK \(\([\s\S]*?\) IS TRUE\)/);
  const constraint=clean.slice(clean.indexOf('ADD CONSTRAINT'),clean.indexOf('$check$,'));
  for(const key of ['version','document_type','title','header','footer','note','show_note']) {
    assert.match(constraint,new RegExp("document_template_snapshot->>?'"+key+"'"));
  }
  assert.match(clean,/SECURITY INVOKER SET search_path = ''/);
  assert.match(clean,/NEW.document_template_snapshot IS DISTINCT FROM OLD.document_template_snapshot/);
  assert.match(clean,/ERRCODE = '23514'/);
  assert.match(clean,/REVOKE ALL ON FUNCTION public.phase639_preserve_document_template\(\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(clean,/BEFORE UPDATE OF document_template_snapshot/);
});
test('639 SQL: UTF8 fail-closed literal pins and read-only post-check C per type',()=>{
  assert.match(clean,/current_setting\('client_encoding'\) <> 'UTF8'/);
  assert.match(clean,/encode\(convert_to\(actual,'UTF8'\),'hex'\) <> expected_hex/);
  const c=sql.slice(sql.indexOf('-- POST-CHECK C:'));
  assert.match(c,/actual_title_hex/);
  assert.match(c,/expected_title_hex/);
  assert.match(c,/IS TRUE AS title_utf8_ok/);
  assert.doesNotMatch(c,/\b(?:INSERT|UPDATE|DELETE|DO|EXECUTE)\b/);
  assert.doesNotMatch(c,/length[^\n]*=\s*11/);
});
