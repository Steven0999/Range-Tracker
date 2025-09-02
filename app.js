const $$ = (s, r=document)=>r.querySelector(s);
const $$$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

// Separate storage for session vs history
const STORAGE_SESSION = 'drivingRange_session';
const STORAGE_HISTORY = 'drivingRange_history';

// Load/save helpers
function load(key){ try{ return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] } }
function save(key, data){ localStorage.setItem(key, JSON.stringify(data)); }

let sessionShots = load(STORAGE_SESSION); // unsaved (live on Logger)
let historyShots = load(STORAGE_HISTORY); // persisted (live in History)

// Date helpers
const fmt = iso=>new Date(iso).toLocaleString();
const toLocal = iso=>{
  const d=new Date(iso);const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const uid=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;

function toast(msg){
  const t=$$('#toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1500);
}

// ---------- Charts (session + history)
let barChart, trendChart, shapeChart, historyBarChart;

function getBar(){
  if (barChart) return barChart;
  barChart = new Chart($$('#clubBars'), {
    type:'bar',
    data:{labels:[],datasets:[
      {label:'Best',data:[],backgroundColor:'#19d27c'},
      {label:'Average',data:[],backgroundColor:'#4d7cff'},
      {label:'Worst',data:[],backgroundColor:'#ff5c5c'}
    ]},
    options:{responsive:true,scales:{y:{beginAtZero:true}}}
  });
  return barChart;
}
function getTrend(){
  if (trendChart) return trendChart;
  trendChart = new Chart($$('#trendChart'), {
    type:'scatter',
    data:{datasets:[
      {label:'Swings',data:[],pointRadius:3,backgroundColor:'#2ea8e8'},
      {type:'line',label:'Trend',data:[],pointRadius:0,borderColor:'#ffaa4d'}
    ]},
    options:{responsive:true,parsing:false,scales:{x:{type:'time'},y:{beginAtZero:true}}}
  });
  return trendChart;
}
function getShape(){
  if (shapeChart) return shapeChart;
  shapeChart = new Chart($$('#shapesChart'), {
    type:'doughnut',
    data:{labels:[],datasets:[{data:[],backgroundColor:['#19d27c','#ff5c5c','#4d7cff','#ffaa4d','#8f6bff','#40e0d0','#ffd700']}]},
    options:{responsive:true}
  });
  return shapeChart;
}
function getHistoryBar(){
  if (historyBarChart) return historyBarChart;
  historyBarChart = new Chart($$('#historyBars'), {
    type:'bar',
    data:{labels:[],datasets:[
      {label:'Best',data:[],backgroundColor:'#19d27c'},
      {label:'Average',data:[],backgroundColor:'#4d7cff'},
      {label:'Worst',data:[],backgroundColor:'#ff5c5c'}
    ]},
    options:{responsive:true,scales:{y:{beginAtZero:true}}}
  });
  return historyBarChart;
}

// ---------- Aggregations
const byClub = (arr)=>arr.reduce((m,s)=>{const k=s.club+(s.isHybrid?' (Hybrid)':''); (m[k]??=[]).push(s); return m;}, {});
const numericOnly = (arr)=>arr.map(s=>parseFloat(s.distance)).filter(n=>!isNaN(n));
function stats(arr){
  const nums = numericOnly(arr);
  if (!nums.length) return {avg:0,min:0,max:0};
  const sum = nums.reduce((a,b)=>a+b,0);
  return {avg:+(sum/nums.length).toFixed(1), min:Math.min(...nums), max:Math.max(...nums)};
}
function regression(points){
  if(points.length<2) return null;
  const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
  const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
  const xbar = mean(xs), ybar = mean(ys);
  let num=0, den=0; for(let i=0;i<xs.length;i++){ num+=(xs[i]-xbar)*(ys[i]-ybar); den+=(xs[i]-xbar)**2; }
  const b = den ? num/den : 0, a = ybar - b*xbar;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  return [{x:minX,y:a+b*minX},{x:maxX,y:a+b*maxX}];
}

// ---------- LOGGER (session) Renders
function renderLogger(){
  // Summary (last 10 in session)
  const recent = [...sessionShots].slice(-10).reverse();
  const st = stats(recent);
  $$('#sessionSummary').innerHTML = `
    <div class="summary">
      <div class="box"><div class="label">Avg (10)</div><div class="val">${st.avg}</div></div>
      <div class="box"><div class="label">Best</div><div class="val">${st.max}</div></div>
      <div class="box"><div class="label">Worst</div><div class="val">${st.min}</div></div>
      <div class="box"><div class="label">Session Swings</div><div class="val">${sessionShots.length}</div></div>
    </div>
  `;

  // Per-club bars for session
  const grouped = byClub(sessionShots);
  const clubs = Object.keys(grouped).sort();
  const best = clubs.map(c=>stats(grouped[c]).max);
  const avg  = clubs.map(c=>stats(grouped[c]).avg);
  const worst= clubs.map(c=>stats(grouped[c]).min);
  const cb = getBar();
  cb.data.labels = clubs; cb.data.datasets[0].data = best; cb.data.datasets[1].data = avg; cb.data.datasets[2].data = worst; cb.update();

  // Trend selector + chart (session)
  const sel = $$('#trendClub');
  sel.innerHTML = clubs.length ? clubs.map(c=>`<option>${c}</option>`).join('') : `<option>No data</option>`;
  if (clubs.length) updateTrend(clubs[0]); else { const tc=getTrend(); tc.data.datasets[0].data=[]; tc.data.datasets[1].data=[]; tc.update(); }

  // Session table
  const tbody = $$('#latestTable tbody');
  tbody.innerHTML = sessionShots.length
    ? [...sessionShots].slice(-12).reverse().map(s=>rowHTML(s,false,true)).join('')
    : `<tr><td colspan="6">No swings this session.</td></tr>`;
}
function updateTrend(clubKey){
  const arr = byClub(sessionShots)[clubKey] || [];
  const pts = arr.map(s=>({x:new Date(s.date).getTime(),y:parseFloat(s.distance)})).filter(p=>!isNaN(p.y)).sort((a,b)=>a.x-b.x);
  const tc = getTrend();
  tc.data.datasets[0].data = pts;
  tc.data.datasets[1].data = regression(pts) || [];
  tc.update();
}

// ---------- HISTORY Renders (with filter + per-club bars)
function renderHistory(){
  // Build club filter from history data
  const grouped = byClub(historyShots);
  const clubs = Object.keys(grouped).sort();
  const sel = $$('#historyClubFilter');
  const prev = sel.value || '__all__';
  sel.innerHTML = `<option value="__all__">All Clubs</option>` + clubs.map(c=>`<option>${c}</option>`).join('');
  sel.value = clubs.includes(prev) ? prev : '__all__';

  renderHistoryFiltered();
}
function renderHistoryFiltered(){
  const selVal = $$('#historyClubFilter').value;
  const filtered = selVal==='__all__' ? historyShots : (byClub(historyShots)[selVal] || []);

  // Stats boxes (filtered)
  const shapeCounts = filtered.reduce((m,s)=> (m[s.shape]=(m[s.shape]||0)+1, m), {});
  $$('#historyStats').innerHTML = `
    <div class="stats">
      <div class="box"><div class="label">Total</div><div class="val">${filtered.length}</div></div>
      ${Object.entries(shapeCounts).map(([k,v])=>`<div class="box"><div class="label">${k}</div><div class="val">${v}</div></div>`).join('')}
    </div>
  `;

  // Shapes chart (filtered)
  const sc = getShape();
  sc.data.labels = Object.keys(shapeCounts);
  sc.data.datasets[0].data = Object.values(shapeCounts);
  sc.update();

  // Per-club Best/Avg/Worst chart (filtered set)
  const grouped = byClub(filtered);
  const clubs = Object.keys(grouped).sort();
  const best = clubs.map(c=>stats(grouped[c]).max);
  const avg  = clubs.map(c=>stats(grouped[c]).avg);
  const worst= clubs.map(c=>stats(grouped[c]).min);
  const hb = getHistoryBar();
  hb.data.labels = clubs;
  hb.data.datasets[0].data = best;
  hb.data.datasets[1].data = avg;
  hb.data.datasets[2].data = worst;
  hb.update();

  // Table (filtered)
  $$('#historyTable tbody').innerHTML = filtered.length
    ? filtered.map(s=>rowHTML(s,true,false)).join('')
    : `<tr><td colspan="6">No saved swings${selVal!=='__all__'?' for this club':''}.</td></tr>`;
}

// ---------- Row HTML (actions differ per view)
function rowHTML(s, withActions, isSession){
  return `
    <tr data-id="${s.id}">
      <td>${fmt(s.date)}</td>
      <td>${s.club}</td>
      <td>${s.isHybrid?'Y':'N'}</td>
      <td>${s.distance}</td>
      <td>${s.shape}</td>
      <td>
        ${withActions ? `
          <button class="btn edit">Edit</button>
          <button class="btn danger delete">Delete</button>
        ` : isSession ? `
          <button class="btn danger delete-session">Remove</button>
        ` : ``}
      </td>
    </tr>
  `;
}

// ---------- Form submit (SESSION ONLY)
function onSubmit(e){
  e.preventDefault();
  const clubType=$$('#clubType').value;
  const isHybrid=$$('#isHybrid').checked;
  const other=$$('#otherClub').value.trim();
  const club=clubType==='Other'?(other||'Other'):clubType;

  const distance=$$('#distance').value.trim();
  const dateVal=$$('#date').value;
  if(!dateVal||!distance){ toast('Fill all fields'); return; }

  sessionShots.push({
    id: uid(),
    date: new Date(dateVal).toISOString(),
    club, isHybrid, distance,
    shape: $$('#shape').value
  });
  save(STORAGE_SESSION, sessionShots);

  // Only reset distance + update date; keep club/hybrid/custom
  $$('#distance').value = "";
  $$('#date').value = toLocal(new Date().toISOString());

  renderLogger();
  toast('Swing added ✔️');
  $$('#distance').focus();
}

// ---------- Edit/Delete (HISTORY)
function startEdit(tr){
  const id = tr.dataset.id;
  const s = historyShots.find(x=>x.id===id);
  if(!s) return;
  tr.innerHTML = `
    <td><input type="datetime-local" class="e-date" value="${toLocal(s.date)}"></td>
    <td>${s.club}</td>
    <td>${s.isHybrid?'Y':'N'}</td>
    <td><input type="text" class="e-dist" value="${s.distance}"></td>
    <td>
      <select class="e-shape">
        ${['Straight','Draw','Fade','Hook','Slice','Pull','Push'].map(v=>`<option ${s.shape===v?'selected':''}>${v}</option>`).join('')}
      </select>
    </td>
    <td><button class="btn save">Save</button> <button class="btn cancel">Cancel</button></td>
  `;
}
function finishEdit(tr, saveIt){
  const id = tr.dataset.id;
  const idx = historyShots.findIndex(x=>x.id === id);
  if(idx<0) return;

  if(saveIt){
    const d = tr.querySelector('.e-date').value;
    const dist = tr.querySelector('.e-dist').value.trim();
    const sh = tr.querySelector('.e-shape').value;
    if(!d || !dist){ toast('Fill all fields ❗'); return; }
    historyShots[idx].date = new Date(d).toISOString();
    historyShots[idx].distance = dist;
    historyShots[idx].shape = sh;
    save(STORAGE_HISTORY, historyShots);
    toast('Saved ✔️');
  }
  renderHistoryFiltered();
}

// ---------- Save Session -> History
function saveSessionToHistory(){
  if(!sessionShots.length){ toast('Nothing to save'); return; }
  historyShots = historyShots.concat(sessionShots);
  save(STORAGE_HISTORY, historyShots);
  sessionShots = [];
  save(STORAGE_SESSION, sessionShots);
  renderLogger();
  toast('Session saved to History ✔️');
}

// ---------- Reset Selections
function resetSelections(){
  $$('#clubType').value='Driver';
  $$('#isHybrid').checked=false;
  $$('#otherClub').value='';
  $$('#otherClubWrap').hidden=true;
  $$('#distance').value='';
  $$('#shape').value='Straight';
  $$('#date').value=toLocal(new Date().toISOString());
  toast('Selections reset ✔️');
  $$('#distance').focus();
}

// ---------- Wiring
function wire(){
  // Nav
  $$$('.nav__btn').forEach(btn => btn.addEventListener('click', ()=>{
    $$$('.view').forEach(v=>v.classList.remove('view--active'));
    $$('#'+btn.dataset.target).classList.add('view--active');
    $$$('.nav__btn').forEach(x=>x.setAttribute('aria-selected', x===btn?'true':'false'));
    if(btn.dataset.target==='historyView'){ renderHistory(); } else { renderLogger(); }
  }));
  // Back button
  $$$('[data-target="loggerView"]').forEach(b=>b.addEventListener('click', ()=>$$('.nav__btn[data-target="loggerView"]').click()));

  // Form
  $$('#swingForm').addEventListener('submit', onSubmit);
  $$('#clubType').addEventListener('change', ()=>{
    $$('#otherClubWrap').hidden = $$('#clubType').value !== 'Other';
  });
  $$('#trendClub').addEventListener('change', e=> updateTrend(e.target.value));

  // Session remove (from session table)
  $$('#latestTable').addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const tr = e.target.closest('tr'); if(!tr) return;
    if(btn.classList.contains('delete-session')){
      const id = tr.dataset.id;
      sessionShots = sessionShots.filter(s=>s.id!==id);
      save(STORAGE_SESSION, sessionShots);
      renderLogger();
      toast('Removed from session ✔️');
    }
  });

  // History table: edit/delete
  $$('#historyTable').addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const tr = e.target.closest('tr'); if(!tr) return;
    if(btn.classList.contains('edit')) startEdit(tr);
    if(btn.classList.contains('delete')){
      const id = tr.dataset.id;
      historyShots = historyShots.filter(s=>s.id!==id);
      save(STORAGE_HISTORY, historyShots);
      renderHistoryFiltered();
      toast('Deleted ✔️');
    }
    if(btn.classList.contains('save')) finishEdit(tr, true);
    if(btn.classList.contains('cancel')) renderHistoryFiltered();
  });

  // History filter dropdown
  $$('#historyClubFilter').addEventListener('change', renderHistoryFiltered);

  // Save session -> history
  $$('#saveSession').addEventListener('click', saveSessionToHistory);

  // Reset selections
  $$('#resetSelections').addEventListener('click', resetSelections);

  // Reset all data
  $$('#resetAll').addEventListener('click', ()=>{
    if(confirm('Delete ALL swings from this browser (session + history)?')){
      sessionShots = []; historyShots = [];
      save(STORAGE_SESSION, sessionShots);
      save(STORAGE_HISTORY, historyShots);
      renderLogger(); renderHistory();
      toast('All data cleared');
    }
  });
}

// ---------- Init
function init(){
  $$('#date').value = toLocal(new Date().toISOString());
  renderLogger();
  renderHistory(); // prepare history filter + charts
  wire();
}

document.addEventListener('DOMContentLoaded', init);
