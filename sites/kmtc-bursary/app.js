'use strict';
const $=s=>document.querySelector(s);
$('#menu').onclick=()=>{const open=$('#nav').classList.toggle('open');$('#menu').setAttribute('aria-expanded',String(open));};
document.querySelectorAll('nav a').forEach(a=>a.onclick=()=>{$('#nav').classList.remove('open');$('#menu').setAttribute('aria-expanded','false');});
const slides=[['assets/kmtc-lab-microscope.jpg','KMTC students in a laboratory'],['assets/kmtc-students-walking.jpg','KMTC students on campus'],['assets/kmtc-main-campus.jpg','KMTC main campus'],['assets/kmtc-classroom-study.jpg','KMTC students studying']];
let slide=0,timer;
function show(n){slide=(n+slides.length)%slides.length;$('#heroImage').src=slides[slide][0];$('#heroImage').alt=slides[slide][1];$('#slideCount').textContent=`0${slide+1} / 0${slides.length}`;}
function play(){timer=setInterval(()=>show(slide+1),6500);}
$('#next').onclick=()=>show(slide+1);$('#prev').onclick=()=>show(slide-1);
$('#pause').onclick=()=>{if(timer){clearInterval(timer);timer=null;$('#pause').textContent='▶';$('#pause').setAttribute('aria-label','Play slideshow');}else{play();$('#pause').textContent='Ⅱ';$('#pause').setAttribute('aria-label','Pause slideshow');}};
if(!matchMedia('(prefers-reduced-motion: reduce)').matches)play();
