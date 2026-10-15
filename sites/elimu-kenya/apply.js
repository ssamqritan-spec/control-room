'use strict';
const $=s=>document.querySelector(s),form=$('#application'),labels=['Studies and funding','Personal details','Review and submit'];let step=0;
function data(){const f=[...form.querySelectorAll('fieldset')];f.forEach(x=>x.disabled=false);const d=Object.fromEntries(new FormData(form));f.forEach((x,i)=>x.disabled=i!==step);return d}
function inst(d){return d.instType==='University'?d.university:d.otherInstitution}
function toggleType(){const u=$('#instType').value==='University',o=!!$('#instType').value&&!u;$('#uniBlock').hidden=!u;$('#otherBlock').hidden=!o;$('#universityList').disabled=!u;$('#universityList').required=u;$('#otherInst').disabled=!o;$('#otherInst').required=o}
function filterU(){const q=$('#universitySearch').value.trim().toLowerCase();let c=0;[...$('#universityList').options].forEach((o,i)=>{o.hidden=i>0&&!o.textContent.toLowerCase().includes(q);if(i>0&&!o.hidden)c++});$('#universityCount').textContent=$('#uniBlock').hidden?'':c+' institutions shown.'}
function render(){form.querySelectorAll('fieldset').forEach((f,i)=>{f.hidden=i!==step;f.disabled=i!==step});$('#stepLabel').textContent=`0${step+1} / ${labels[step]}`;$('#stepNumber').textContent=`STEP ${step+1} OF 3`;$('#progressBar').style.width=((step+1)/3*100)+'%';$('#back').hidden=step===0;$('#continue').textContent=step===2?'Submit application':'Continue →';$('#formStatus').textContent='';
if(step===2){const d=data(),r=$('#review');r.replaceChildren();[['Name',d.student],['Phone',d.phone],['Email',d.email],['Institution',inst(d)+' ('+d.instType+')'],['Course / year',d.course+' / '+d.year],['HELB / HEF support',d.helb],['Funding band','Band '+d.band],['Home county',d.county],['Parent / guardian',d.guardian+' ('+d.relationship+')'],['Circumstances',d.condition]].forEach(([k,v])=>{const a=document.createElement('dt'),b=document.createElement('dd');a.textContent=k;b.textContent=v;r.append(a,b)});
$('#feeHead').textContent='You will receive '+money(AMOUNTS[d.band])+' (Band '+d.band+')';$('#feeText').textContent='To submit your details and get this bursary, you pay a government processing fee of '+money(FEES[d.band])+'. You will pay it on the next page, right after you submit.'}}
$('#continue').onclick=async()=>{if(!form.reportValidity())return;if(step<2){step++;render();window.scrollTo({top:0,behavior:'smooth'});return}
const d=data(),btn=$('#continue');btn.disabled=true;btn.textContent='Submitting…';
try{const p={...d,institution:inst(d),site:SITE};delete p.consent;delete p.otherInstitution;delete p.universitySearch;
const res=await rpc('submit_application',{p});const out=res||{ref:'EK-'+Date.now().toString(36).toUpperCase(),amount:AMOUNTS[d.band],fee:FEES[d.band]};
sessionStorage.setItem('elimu-app',JSON.stringify({ref:out.ref,amount:out.amount,fee:out.fee,name:d.student,phone:d.phone}));location.href='pay.html'}
catch(e){console.error(e);$('#formStatus').textContent='We could not submit your application. Check your connection and try again.';btn.disabled=false;btn.textContent='Submit application'}};
$('#back').onclick=()=>{step--;render()};form.onsubmit=e=>{e.preventDefault();$('#continue').click()};
$('#instType').onchange=()=>{toggleType();filterU()};$('#universitySearch').oninput=filterU;toggleType();filterU();render();
