begin;
alter table public.directory_qrs drop constraint directory_qrs_style_valid;
alter table public.directory_qrs add constraint directory_qrs_style_valid check (
 qr_style is null or (
  jsonb_typeof(qr_style)='object'
  and qr_style ?& array['palette','shape','logo']
  and (qr_style-'palette'-'shape'-'logo'-'colour')='{}'::jsonb
  and qr_style->>'palette' in ('classic','payindex','midnight','cyber','pink','crimson','coral','amber','olive','forest','teal','ocean','indigo','violet','plum')
  and (not (qr_style ? 'colour') or (
    qr_style->>'palette' in ('classic','payindex','midnight','cyber')
    and jsonb_typeof(qr_style->'colour')='string'
    and qr_style->>'colour' in ('black','slate','navy','blue','pink','crimson','coral','amber','olive','forest','teal','ocean','indigo','violet','plum')
  ))
  and qr_style->>'shape' in ('square','rounded','dots','classy')
  and jsonb_typeof(qr_style->'logo')='boolean'
  and jsonb_typeof(qr_style->'palette')='string'
  and jsonb_typeof(qr_style->'shape')='string'
 ) is true
);

notify pgrst, 'reload schema';
commit;
