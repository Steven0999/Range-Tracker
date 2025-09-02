/* Fast Driving Range Tracker
   - Compact UI
   - Numeric-only distance input
   - Debounced renders
   - Charts reused (not destroyed each render)
*/
const $$ = (s, r=document) => r.querySelector(s);
const $$$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const STORAGE_KEY = 'drivingRangeShotsV2';

const fmtDateTime = (iso) => new Date(iso).toLocaleString();
const toDatetimeLocal = (iso) => {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;

// State
let shots = load();
function load(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] } catch { return [] } }
function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(shots)) }

// Debounce helper
let rafToken = null;
const schedule = (fn) => { cancelAnimationFrame(rafToken); rafToken = requestAnimationFrame(fn); };

// Toast
let toastTimer;
function toast(msg){
  const el = $$('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=> el.classList.remove('show'), 1500);
}

// ====== Charts (created once) ======
let clubBarsChart = null, trendChart = null, shapesChart = null;

function getClubBarsChart(){
  if (clubBarsChart) return clubBarsChart;
  clubBarsChart = new Chart($$('#clubBars').getContext('2d'), {
    type:'bar',
    data:{ labels:[], datasets:[
      {label:'Best', data:[], backgroundColor:'#19d27c'},
      {label:'Average', data:[], backgroundColor:'#4d7cff'},
      {label:'Worst', data:[], backgroundColor:'#ff5c5c'}
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      animation:false,
      scales:{ y:{ beginAtZero:true, title:{display:true, text:'Yards'} } },
      plugins:{ legend:{ labels:{ color:'#cfe3ff' } } }
    }
  });
  return clubBarsChart;
}

function getTrendChart(){
  if (trendChart) return trendChart;
  trendChart = new Chart($$('#trendChart').getContext('2d'), {
    type:'scatter',
    data:{ datasets:[
      { type:'scatter', label:'Swings', data:[], borderColor:'#2ea8e8', backgroundColor:'#2ea8e8', pointRadius:3 },
      { type:'line', label:'Trend', data:[], borderColor:'#ffaa4d', borderWidth:2, pointRadius:0, fill:false, tension:0 }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, animation:false, parsing:false,
      scales:{
        x:{ type:'time', time:{ unit:'day' }, title:{ display:true, text:'Date' } },
        y:{ beginAtZero:true, title:{ display:true, text:'Yards' } }
      },
      plugins:{ legend:{ labels:{ color:'#cfe3ff' } } }
    }
  });
  return trendChart;
}

function getShapesChart(){
  if (shapesChart) return shapesChart;
  shapesChart = new Chart($$('#shapesChart').getContext('2d'), {
    type:'doughnut',
    data:{ labels:[], datasets:[{ data:[], backgroundColor:['#19d27c','#ff5c5c','#4d7cff','#ffaa4d','#8f6bff','#40e0d0','#ffd700'] }] },
    options:{ responsive:true, maintainAspectRatio:false, animation:false, plugins:{ legend:{ labels:{ color:'#cfe3ff' } } } }
  });
  return shapesChart;
}

// ====== Aggregations ======
function byClub(arr = shots){
  const m = new Map();
  for(const s of arr){
    const key = s.club + (s.isHybrid ? ' (Hybrid)' : '');
    if(!m.has(key)) m.set(key, []);
    m.get(key).push(s);
  }
  return m;
}
function stats(arr){
  if(!arr.length) return {count:0, avg:0, min:0, max:0};
  const ds = arr.map(s=>s.distance);
  const sum = ds.reduce((a,b)=>a+b,0);
  return {count:arr.length, avg:+(sum/arr.length).toFixed(1), min:Math.min(...ds), max:Math.max(...ds)};
}
function tallyShapes(arr = shots){
  const t = new Map();
  for(const s of arr) t.set(s.shape, (t.get(s.shape)||0)+1);
  return t;
}
function regression(points){ // [{x:ts, y:num}]
  if(points.length<2) return null;
  const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
  const n = points.length, mean = a => a.reduce((s,v)=>s+v,0)/a.length;
  const xbar=mean(xs), ybar=mean(ys);
  let num=0, den=0;
  for(let i=0;i<n;i++){ num+=(xs[i]-xbar)*(ys[i]-ybar); den+=(xs[i]-xbar)**2; }
  const b = den===0 ? 0 : num/den, a = ybar - b*xbar;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  return [{x:minX, y:a+b*minX}, {x:maxX, y:a+b*maxX}];
}

// ====== Renders ======
function renderAll(){
  renderLoggerSide();
  if($$('#historyView').classList.contains('view--active')) renderHistory();
}

function renderLoggerSide(){
  // Session summary (last 10)
  const recent = [...shots].sort((a,b)=> b.date.localeCompare(a.date)).slice(0,10);
  const st = stats(recent);
  const straight = recent.filter(s=>s.shape==='Straight').length;
  const hooks = recent.filter(s=>s.shape==='Hook').length;
  const slices = recent.filter(s=>s.shape==='Slice').length;
  $$('#sessionSummary').innerHTML = `
    <div class="summary">
      <div class="box"><div class="label">Recent Avg</div><div class="val">${st.avg} yds</div></div>
      <div class="box"><div class="label">Best (10)</div><div class="val">${st.max||0}</div></div>
      <div class="box"><div class="label">Worst (10)</div><div class="val">${st.min||0}</div></div>
      <div class="box"><div class="label">Shapes (10)</div><div class="val">S:${straight} • H:${hooks} • Sl:${slices}</div></div>
    </div>
  `;

  // Club bars
  const m = byClub();
  const clubs = [...m.keys()].sort((a,b)=>a.localeCompare(b));
  const best = clubs.map(c=>stats(m.get(c)).max);
  const avg  = clubs.map(c=>stats(m.get(c)).avg);
  const worst= clubs.map(c=>stats(m.get(c)).min || 0);

  const cb = getClubBarsChart();
  cb.data.labels = clubs;
  cb.data.datasets[0].data = best;
  cb.data.datasets[1].data = avg;
  cb.data.datasets[2].data = worst;
  cb.update();

  // Trend selector + chart
  const sel = $$('#trendClub');
  sel.innerHTML = clubs.length ? clubs.map(c=>`<option>${c}</option>`).join('') : `<option>No data yet</option>`;
  if(clubs.length){
    if(!sel.value || !clubs.includes(sel.value)) sel.value = clubs[0];
    updateTrend(sel.value);
  }else{
    const tc = getTrendChart();
    tc.data.datasets[0].data = [];
    tc.data.datasets[1].data = [];
    tc.update();
  }

  // Latest table
  const tbody = $$('#latestTable tbody');
  const latest = [...shots].sort((a,b)=> b.date.localeCompare(a.date)).slice(0,12);
  tbody.innerHTML = latest.length ? latest.map(s=>rowHTML(s,false)).join('') : `<tr><td colspan="6" class="small">No swings yet.</td></tr>`;
}

function updateTrend(clubKey){
  const map = byClub();
  const arr = map.get(clubKey) || [];
  const pts = arr.map(s=>({ x:new Date(s.date).getTime(), y:s.distance, meta:s })).sort((a,b)=>a.x-b.x);
  const tc = getTrendChart();
  tc.data.datasets[0].data = pts;
  tc.data.datasets[1].data = regression(pts) || [];
  tc.update();
}

function renderHistory(){
  // Stats boxes
  const t = tallyShapes();
  const total = shots.length;
  const straight = t.get('Straight')||0, hook = t.get('Hook')||0, slice = t.get('Slice')||0;
  $$('#historyStats').innerHTML = `
    <div class="stats">
      <div class="box"><div class="label">Total Swings</div><div class="val">${total}</div></div>
      <div class="box"><div class="label">Straight</div><div class="val">${straight}</div></div>
      <div class="box"><div class="label">Hook</div><div class="val">${hook}</div></div>
      <div class="box"><div class="label">Slice</div><div class="val">${slice}</div></div>
    </div>
  `;

  // Shapes donut
  const labels = Array.from(t.keys()).sort();
  const data = labels.map(k=>t.get(k));
  const sc = getShapesChart();
  sc.data.labels = labels;
  sc.data.datasets[0].data = data;
  sc.update();

  // Full table
  const tbody = $$('#historyTable tbody');
  const rows = [...shots].sort((a,b)=> b.date.localeCompare(a.date));
  tbody.innerHTML = rows.length ? rows.map(s=>rowHTML(s,true)).join('') : `<tr><td colspan="6" class="small">No swings recorded.</td></tr>`;
}

function rowHTML(s, withActions){
  return `
    <tr data-id="${s.id}">
      <td>${fmtDateTime(s.date)}</td>
      <td>${s.club}</td>
      <td>${s.isHybrid?'Y':'N'}</td>
      <td class="distance">${s.distance}</td>
      <td class="shape">${s.shape}</td>
      <td>${withActions?`<button class="btn primary btn-sm edit">Edit</button> <button class="btn danger btn-sm delete">Delete</button>`:''}</td>
    </tr>
  `;
}

// ====== Events & Editing ======
function onSubmit(e){
  e.preventDefault();
  const clubType = $$('#clubType').value;
  const isHybrid = $$('#isHybrid').checked;
  const other = $$('#otherClub').value.trim();
  const club = clubType === 'Other' ? (other || 'Other') : clubType;

  const distRaw = $$('#distance').value.trim();
  if(!distRaw){ toast('Enter distance in yards ❗'); return; }
  const distance = Math.max(1, Math.min(2000, parseInt(distRaw,10) || 0));
  if(!distance){ toast('Distance must be digits only ❗'); return; }

  const dateVal = $$('#date').value;
  if(!dateVal){ toast('Pick a date/time ❗'); return; }

  shots.push({
    id: uid(),
    date: new Date(dateVal).toISOString(),
    club, isHybrid, distance,
    shape: $$('#shape').value
  });
  save();
  e.target.reset();
  $$('#otherClubWrap').hidden = true;
  $$('#clubType').value = 'Driver';
  $$('#shape').value = 'Straight';
  $$('#date').value = toDatetimeLocal(new Date().toISOString());
  schedule(renderAll);
  toast('Swing added ✔️');
}

function startEdit(tr){
  const id = tr.dataset.id;
  const s = shots.find(x=>x.id===id); if(!s) return;
  tr.innerHTML = `
    <td><input type="datetime-local" class="e-date" value="${toDatetimeLocal(s.date)}"></td>
    <td>${s.club}</td>
    <td>${s.isHybrid?'Y':'N'}</td>
    <td><input type="text" class="e-dist" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${s.distance}"></td>
    <td>
      <select class="e-shape">
        ${['Straight','Draw','Fade','Hook','Slice','Pull','Push'].map(v=>`<option ${s.shape===v?'selected':''}>${v}</option>`).join('')}
      </select>
    </td>
    <td><button class="btn primary save">Save</button> <button class="btn cancel">Cancel</button></td>
  `;
  // numeric-only in edit row
  const ed = tr.querySelector('.e-dist');
  enforceNumericOnly(ed);
}

function finishEdit(tr, saveIt){
  const id = tr.dataset.id;
  const idx = shots.findIndex(x=>x.id===id); if(idx<0) return;

  if(saveIt){
    const d = tr.querySelector('.e-date').value;
    const distStr = (tr.querySelector('.e-dist').value||'').replace(/\D+/g,'');
    const sh = tr.querySelector('.e-shape').value;
    if(!d || !distStr){ toast('Enter valid date & distance ❗'); return; }
    shots[idx].date = new Date(d).toISOString();
    shots[idx].distance = Math.max(1, Math.min(2000, parseInt(distStr,10)));
    shots[idx].shape = sh;
    save(); toast('Updated ✔️');
  }
  schedule(()=>{ renderHistory(); renderLoggerSide(); });
}

function wire(){
  // Nav
  $$$('.nav__btn').forEach(b=>b.addEventListener('click', ()=>{
    $$$('.view').forEach(v=>v.classList.remove('view--active'));
    $$('#'+b.dataset.target).classList.add('view--active');
    $$$('.nav__btn').forEach(x=>x.setAttribute('aria-selected', x===b ? 'true' : 'false'));
    if(b.dataset.target==='historyView') renderHistory(); else renderLoggerSide();
  }));
  // Back button
  $$$('[data-target="loggerView"]').forEach(b=>b.addEventListener('click', ()=>$$('.nav__btn[data-target="loggerView"]').click()));

  // Form
  $$('#swingForm').addEventListener('submit', onSubmit);
  $$('#swingForm').addEventListener('reset', ()=>setTimeout(()=> $$('#distance').focus(),0));
  $$('#clubType').addEventListener('change', ()=>{
    const isOther = $$('#clubType').value==='Other';
    $$('#otherClubWrap').hidden = !isOther;
    if(isOther) $$('#otherClub').focus();
  });
  $$('#trendClub').addEventListener('change', e=> updateTrend(e.target.value));

  // Distance numeric-only (prevents your typing issue + blocks non-digits)
  enforceNumericOnly($$('#distance'));

  // Edit/Delete in history (event delegation)
  $$('#historyTable').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const tr = e.target.closest('tr'); if(!tr) return;
    if(btn.classList.contains('edit')) return startEdit(tr);
    if(btn.classList.contains('delete')){
      const id = tr.dataset.id;
      shots = shots.filter(s=>s.id!==id); save(); schedule(()=>{ renderHistory(); renderLoggerSide(); }); toast('Deleted ✔️'); return;
    }
    if(btn.classList.contains('save')) return finishEdit(tr, true);
    if(btn.classList.contains('cancel')) return renderHistory();
  });

  // Reset all
  $$('#resetAll').addEventListener('click', ()=>{
    if(confirm('Delete ALL swings from this browser?')){
      shots = []; save(); schedule(renderAll); toast('All data cleared');
    }
  });

  // Prevent accidental scroll-wheel distance changes anywhere
  document.addEventListener('wheel', (e)=>{
    if(e.target && (e.target.id==='distance' || e.target.classList?.contains('e-dist'))){
      e.preventDefault();
    }
  }, { passive:false });
}

// Enforce numeric-only behavior on a text input
function enforceNumericOnly(input){
  input.addEventListener('beforeinput', (e)=>{
    if(e.data && /\D/.test(e.data)) e.preventDefault();
  });
  input.addEventListener('input', (e)=>{
    const v = e.target.value.replace(/\D+/g,'').slice(0,4); // max 4 digits (up to 2000)
    if(e.target.value !== v) e.target.value = v;
  });
  input.addEventListener('keypress', (e)=>{
    if(!/[0-9]/.test(e.key)) e.preventDefault();
  });
  input.addEventListener('paste', (e)=>{
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text') || '';
    const digits = text.replace(/\D+/g,'').slice(0,4);
    document.execCommand('insertText', false, digits);
  });
}

// ===== Init =====
function init(){
  $$('#date').value = toDatetimeLocal(new Date().toISOString());
  renderLoggerSide();
  wire();
}
document.addEventListener('DOMContentLoaded', init);
