const $$ = (s, r=document)=>r.querySelector(s);
const $$$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
const STORAGE_KEY = 'drivingRangeFreeForm';

let shots = load();
function load(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||[]}catch{return[]}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(shots))}

const fmt = iso=>new Date(iso).toLocaleString();
const toLocal = iso=>{
  const d=new Date(iso);const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const uid=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
function toast(msg){const t=$$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1500)}

// Charts
let barChart,trendChart,shapeChart;
function getBar(){if(barChart)return barChart;barChart=new Chart($$('#clubBars'),{type:'bar',data:{labels:[],datasets:[{label:'Best',data:[],backgroundColor:'#19d27c'},{label:'Average',data:[],backgroundColor:'#4d7cff'},{label:'Worst',data:[],backgroundColor:'#ff5c5c'}]},options:{responsive:true,scales:{y:{beginAtZero:true}}}});return barChart}
function getTrend(){if(trendChart)return trendChart;trendChart=new Chart($$('#trendChart'),{type:'scatter',data:{datasets:[{label:'Swings',data:[],pointRadius:3,backgroundColor:'#2ea8e8'},{type:'line',label:'Trend',data:[],borderColor:'#ffaa4d',pointRadius:0}]},options:{responsive:true,scales:{x:{type:'time'},y:{beginAtZero:true}}}});return trendChart}
function getShape(){if(shapeChart)return shapeChart;shapeChart=new Chart($$('#shapesChart'),{type:'doughnut',data:{labels:[],datasets:[{data:[],backgroundColor:['#19d27c','#ff5c5c','#4d7cff','#ffaa4d','#8f6bff','#40e0d0','#ffd700']}]},options:{responsive:true}});return shapeChart}

// Helpers
function byClub(){const m=new Map();shots.forEach(s=>{const k=s.club+(s.isHybrid?' (Hybrid)':'');if(!m.has(k))m.set(k,[]);m.get(k).push(s)});return m}
function numericOnly(arr){return arr.map(s=>parseFloat(s.distance)).filter(n=>!isNaN(n))}
function stats(arr){const nums=numericOnly(arr);if(!nums.length)return{avg:0,min:0,max:0};const sum=nums.reduce((a,b)=>a+b,0);return{avg:+(sum/nums.length).toFixed(1),min:Math.min(...nums),max:Math.max(...nums)}}
function regression(points){if(points.length<2)return null;const xs=points.map(p=>p.x),ys=points.map(p=>p.y),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;const xbar=mean(xs),ybar=mean(ys);let num=0,den=0;for(let i=0;i<points.length;i++){num+=(xs[i]-xbar)*(ys[i]-ybar);den+=(xs[i]-xbar)**2}const b=den?num/den:0,a=ybar-b*xbar;return[{x:Math.min(...xs),y:a+b*Math.min(...xs)},{x:Math.max(...xs),y:a+b*Math.max(...xs)}]}

// Renders
function renderLogger(){
  const recent=[...shots].slice(-10).reverse();const st=stats(recent);
  $$('#sessionSummary').innerHTML=`
    <div class="summary">
      <div class="box"><div class="label">Avg (10)</div><div class="val">${st.avg}</div></div>
      <div class="box"><div class="label">Best</div><div class="val">${st.max}</div></div>
      <div class="box"><div class="label">Worst</div><div class="val">${st.min}</div></div>
      <div class="box"><div class="label">Swings</div><div class="val">${shots.length}</div></div>
    </div>`;
  const m=byClub();const clubs=[...m.keys()].sort();
  const best=clubs.map(c=>stats(m.get(c)).max);
  const avg=clubs.map(c=>stats(m.get(c)).avg);
  const worst=clubs.map(c=>stats(m.get(c)).min);
  const cb=getBar();cb.data.labels=clubs;cb.data.datasets[0].data=best;cb.data.datasets[1].data=avg;cb.data.datasets[2].data=worst;cb.update();
  const sel=$$('#trendClub');sel.innerHTML=clubs.map(c=>`<option>${c}</option>`).join('');if(clubs.length)updateTrend(clubs[0]);
  const tbody=$$('#latestTable tbody');tbody.innerHTML=shots.slice(-12).reverse().map(s=>rowHTML(s,false)).join('')||'<tr><td colspan="6">No swings</td></tr>';
}
function updateTrend(club){const arr=byClub().get(club)||[];const pts=arr.map(s=>({x:new Date(s.date).getTime(),y:parseFloat(s.distance)})).filter(p=>!isNaN(p.y));const tc=getTrend();tc.data.datasets[0].data=pts;tc.data.datasets[1].data=regression(pts)||[];tc.update()}
function renderHistory(){const t={};shots.forEach(s=>t[s.shape]=(t[s.shape]||0)+1);const hs=$$('#historyStats');hs.innerHTML=`<div class="stats"><div class="box"><div class="label">Total</div><div class="val">${shots.length}</div></div>${Object.entries(t).map(([k,v])=>`<div class="box"><div class="label">${k}</div><div class="val">${v}</div></div>`).join('')}</div>`;const sc=getShape();sc.data.labels=Object.keys(t);sc.data.datasets[0].data=Object.values(t);sc.update();$$('#historyTable tbody').innerHTML=shots.map(s=>rowHTML(s,true)).join('')||'<tr><td colspan="6">No swings</td></tr>'}
function rowHTML(s,act){return `<tr data-id="${s.id}"><td>${fmt(s.date)}</td><td>${s.club}</td><td>${s.isHybrid?'Y':'N'}</td><td>${s.distance}</td><td>${s.shape}</td><td>${act?'<button class="btn edit">Edit</button><button class="btn danger delete">Delete</button>':''}</td></tr>`}

// Events
function onSubmit(e){
  e.preventDefault();
  const clubType=$$('#clubType').value;
  const isHybrid=$$('#isHybrid').checked;
  const other=$$('#otherClub').value.trim();
  const club=clubType==='Other'?(other||'Other'):clubType;
  const distance=$$('#distance').value.trim();
  const dateVal=$$('#date').value;
  if(!dateVal||!distance){toast('Fill all fields');return}
  shots.push({id:uid(),date:new Date(dateVal).toISOString(),club,isHybrid,distance,shape:$$('#shape').value});
  save();

  // Only reset distance + update date
  $$('#distance').value="";
  $$('#date').value=toLocal(new Date().toISOString());

  renderLogger();
  toast('Swing added ✔️');
  $$('#distance').focus();
}
function startEdit(tr){const id=tr.dataset.id;const s=shots.find(x=>x.id===id);tr.innerHTML=`<td><input type="datetime-local" class="e-date" value="${toLocal(s.date)}"></td><td>${s.club}</td><td>${s.isHybrid?'Y':'N'}</td><td><input type="text" class="e-dist" value="${s.distance}"></td><td><select class="e-shape">${['Straight','Draw','Fade','Hook','Slice','Pull','Push'].map(v=>`<option ${s.shape===v?'selected':''}>${v}</option>`).join('')}</select></td><td><button class="btn save">Save</button><button class="btn cancel">Cancel</button></td>`}
function finishEdit(tr,saveIt){const id=tr.dataset.id;const idx=shots.findIndex(x=>x.id===id);if(idx<0)return;if(saveIt){const d=tr.querySelector('.e-date').value;const dist=tr.querySelector('.e-dist').value.trim();const sh=tr.querySelector('.e-shape').value;if(!d||!dist){toast('Fill all fields ❗');return}shots[idx].date=new Date(d).toISOString();shots[idx].distance=dist;shots[idx].shape=sh;save();toast('Updated ✔️')}renderHistory();renderLogger()}
function wire(){
  $$$('.nav__btn').forEach(btn=>btn.addEventListener('click',()=>{$$$('.view').forEach(v=>v.classList.remove('view--active'));$$('#'+btn.dataset.target).classList.add('view--active');$$$('.nav__btn').forEach(x=>x.setAttribute('aria-selected',x===btn?'true':'false'));if(btn.dataset.target==='historyView')renderHistory();else renderLogger();}));
  $$$('[data-target="loggerView"]').forEach(b=>b.addEventListener('click',()=>$$('.nav__btn[data-target="loggerView"]').click()));
  $$('#swingForm').addEventListener('submit',onSubmit);
  $$('#clubType').addEventListener('change',()=>{$$('#otherClubWrap').hidden=$$('#clubType').value!=='Other';});
  $$('#trendClub').addEventListener('change',e=>updateTrend(e.target.value));
  $$('#historyTable').addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;const tr=e.target.closest('tr');if(!tr)return;if(btn.classList.contains('edit'))startEdit(tr);if(btn.classList.contains('delete')){shots=shots.filter(s=>s.id!==tr.dataset.id);save();renderHistory();renderLogger();toast('Deleted ✔️')}if(btn.classList.contains('save'))finishEdit(tr,true);if(btn.classList.contains('cancel'))renderHistory();});
  $$('#resetAll').addEventListener('click',()=>{if(confirm('Delete ALL swings?')){shots=[];save();renderLogger();renderHistory();toast('Cleared')}});

  // Reset selections button
  $$('#resetSelections').addEventListener('click',()=>{
    $$('#clubType').value='Driver';
    $$('#isHybrid').checked=false;
    $$('#otherClub').value='';
    $$('#otherClubWrap').hidden=true;
    $$('#distance').value='';
    $$('#shape').value='Straight';
    $$('#date').value=toLocal(new Date().toISOString());
    toast('Selections reset ✔️');
    $$('#distance').focus();
  });
}
function init(){$$('#date').value=toLocal(new Date().toISOString());renderLogger();wire()}
document.addEventListener('DOMContentLoaded',init);
