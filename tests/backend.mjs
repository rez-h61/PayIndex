import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const url=process.env.TEST_SUPABASE_URL,key=process.env.TEST_SUPABASE_PUBLISHABLE_KEY,email=process.env.TEST_ADMIN_EMAIL,password=process.env.TEST_ADMIN_PASSWORD;
if(!url||!key||!email||!password||process.env.PAYINDEX_STAGING_TEST!=='true'){console.error('NOT RUN: provide staging URL, publishable key, admin email/password and PAYINDEX_STAGING_TEST=true. See README.');process.exit(2);}
const makeClient=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}});
const admin=makeClient(),visitor=makeClient();const ok=r=>{assert.equal(r.error,null,r.error?.message);return r.data;};const denied=r=>assert.ok(r.error||(Array.isArray(r.data)&&r.data.length===0));
const png=readFileSync('public/icon-192.png'),person=randomUUID(),qr=randomUUID();let personRecord;
const signed=ok(await admin.auth.signInWithPassword({email,password}));assert.equal(ok(await admin.rpc('is_directory_admin')),true,'Use the configured staging admin');
async function change(fields,file,token=signed.session.access_token){const form=new FormData();for(const[k,v]of Object.entries(fields))if(v!==undefined&&v!==null)form.set(k,v);if(file){form.set('file',new Blob([file],{type:'image/png'}),'fixture.png');form.set('acknowledged','true');}const r=await fetch(url+'/functions/v1/directory-manage',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`},body:form});return{status:r.status,body:await r.json()};}
try{
 assert.equal((await change({action:'save_person',id:person,display_name:'Staging Test Person',avatar_mode:'none'})).status,200);
 personRecord=ok(await admin.from('directory_people').select('*').eq('id',person).single());
 assert.equal(ok(await visitor.from('directory_people').select('*').eq('id',person)).length,1);
 denied(await visitor.from('directory_people').update({display_name:'Unauthorized'}).eq('id',person));
 denied(await visitor.rpc('directory_mutate',{actor:signed.user.id,action:'delete_person',entity_id:person}));
 assert.equal((await change({action:'delete_person',id:person},undefined,key)).status,401);
 console.log('PASS: public directory reads, denied visitor mutation and forged RPC');
 assert.equal((await change({action:'save_qr',id:qr,person_id:person,label:'Maybank'},Buffer.from('<html>not an image</html>'))).status,400);
 assert.equal((await change({action:'save_qr',id:qr,person_id:person,label:'Maybank'},png)).status,200);
 let current=ok(await visitor.from('directory_qrs').select('*').eq('id',qr).single());
 const original=ok(await visitor.storage.from('directory-assets').download(current.storage_path));assert.deepEqual(Buffer.from(await original.arrayBuffer()),png);
 denied(await visitor.storage.from('directory-assets').createSignedUrl(current.storage_path,3600));
 denied(await visitor.storage.from('directory-assets').upload(current.storage_path,png,{upsert:true,contentType:'image/png'}));
 console.log('PASS: validated upload, original public download, denied signing and direct file mutation');
 const before=current;
 const replacements=await Promise.all([change({action:'save_qr',id:qr,person_id:person,label:'Maybank',expected_updated_at:before.updated_at},png),change({action:'save_qr',id:qr,person_id:person,label:'Maybank',expected_updated_at:before.updated_at},png)]);
 assert.deepEqual(replacements.map(r=>r.status).sort(),[200,409]);
 current=ok(await visitor.from('directory_qrs').select('*').eq('id',qr).single());assert.notEqual(current.storage_path,before.storage_path);
 denied(await visitor.storage.from('directory-assets').download(before.storage_path));
 assert.equal((await change({action:'delete_qr',id:qr,expected_updated_at:before.updated_at})).status,409);
 assert.equal((await change({action:'delete_qr',id:qr,expected_updated_at:current.updated_at})).status,200);
 denied(await visitor.storage.from('directory-assets').download(current.storage_path));
 console.log('PASS: concurrent replacement, stale deletion rejection, deleted-file read denial');
}finally{
 if(personRecord){const result=await change({action:'delete_person',id:person,expected_updated_at:personRecord.updated_at});if(result.status!==200)console.error('Remove staging test person manually:',person);}
 await admin.auth.signOut({scope:'local'});
}
