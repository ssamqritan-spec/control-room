// Fill in from Supabase > Project Settings > API. The anon key is safe in the browser: tables are locked by RLS.
window.ELIMU={url:'',key:''};
window.SITE='elimu';// which website this is. The control room keeps Elimu and KMTC records separate using this.
window.FEES={1:300,2:250,3:200,4:150,5:100};
window.AMOUNTS={1:20000,2:16250,3:12500,4:8750,5:5000};
window.money=n=>'KSh '+Number(n).toLocaleString('en-KE');
window.rpc=async(fn,body)=>{const c=window.ELIMU;if(!c.url)return null;const r=await fetch(c.url+'/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:c.key,Authorization:'Bearer '+c.key},body:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json();};
