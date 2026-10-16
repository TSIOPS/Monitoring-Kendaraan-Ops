// Salin semua objek bucket Supabase "foto" ke R2 lewat endpoint Worker (tidak menghapus apa pun).
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^"|"$/g,'')]}));
const token = readFileSync(process.argv[2], 'utf8').trim();
const h={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
const keys=[];
async function walk(prefix){ for(let off=0;;off+=1000){ const a=await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/foto`,{method:'POST',headers:h,body:JSON.stringify({prefix,limit:1000,offset:off})})).json(); for(const it of a){ if(it.id===null) await walk(prefix+it.name+'/'); else keys.push(prefix+it.name);} if(a.length<1000) break; } }
await walk('');
console.log('total objek di Supabase:', keys.length);
const tot={disalin:0,sudahAda:0,gagal:[]};
for(let i=0;i<keys.length;i+=40){
  const batch=keys.slice(i,i+40);
  for(let coba=0;coba<3;coba++){
    try{ const r=await fetch('https://monitoring.kendaraanoprtsi.workers.dev/api/admin/salin-foto',{method:'POST',headers:{'Content-Type':'application/json','X-Migrasi-Token':token},body:JSON.stringify({keys:batch})}); const j=await r.json(); if(!j.success) throw new Error(JSON.stringify(j)); tot.disalin+=j.disalin; tot.sudahAda+=j.sudahAda; tot.gagal.push(...j.gagal); break; }
    catch(e){ if(coba===2){ console.log('batch gagal',i,e.message); tot.gagal.push(...batch);} }
  }
  if((i/40)%10===0) console.log(`${Math.min(i+40,keys.length)}/${keys.length}`, JSON.stringify({disalin:tot.disalin,sudahAda:tot.sudahAda,gagal:tot.gagal.length}));
}
console.log('SELESAI', JSON.stringify({disalin:tot.disalin,sudahAda:tot.sudahAda,gagal:tot.gagal.length}), tot.gagal.slice(0,5));
