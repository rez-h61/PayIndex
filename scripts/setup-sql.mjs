import { readFileSync,writeFileSync } from 'node:fs';
// Convenience installer only. Migration files remain the source of truth.
writeFileSync('supabase/setup-new.sql','-- Fresh PayIndex installations only. Existing installations: run migration 002 only.\n\n'+['supabase/migrations/202610060001_payindex.sql','supabase/migrations/202610060002_single_admin_directory.sql'].map(path=>readFileSync(path,'utf8')).join('\n\n'));
