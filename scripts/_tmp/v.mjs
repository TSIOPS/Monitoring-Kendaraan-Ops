import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^"|"$/g,'')]}));
const h={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
const r=await (await fetch(`${env.SUPABASE_URL}/rest/v1/penggunaan_bbm?select=foto_km_awal,foto_km_akhir&foto_km_awal=like./foto/*&limit=1000`,{headers:h})).json();
const pick=[r[0],r[Math.floor(r.length/2)],r[r.length-1]];
for(const x of pick){ for(const u of [x.foto_km_awal, x.foto_km_awal.replace('/foto/','/foto/thumb/').replace(/\.[a-z]+$/i,'.jpg')]){ const res=await fetch('https://monitoring.kendaraanoprtsi.workers.dev'+u); console.log(res.status, res.headers.get('content-type'), u.slice(0,60)); } }
