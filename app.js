const $$ = (s, r=document)=>r.querySelector(s);
const $$$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

// Separate storage for session vs history
const STORAGE_SESSION = 'drivingRange_session';
const STORAGE_HISTORY = 'drivingRange_history';

// Load/save helpers
function load(key){ try{ return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] } }
function save(key, data){ localStorage.setItem(key, JSON.stringify(data)); }

let sessionShots = load(STORAGE_SESSION); // unsaved (Logger)
let historyShots = load(STORAGE_HISTORY); // persisted (History)

// Date helpers
const fmt = iso=>new Date(iso).toLocaleString();
const toLocal = iso=>{
  const d=new Date(iso);const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const uid=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;

function toast(msg){ const t=$$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 1500); }

// ---------- Charts (history only)
let historyBarChart, clubShapesBarChart, clubDistanceLineChart;

function getHistoryBar(){
  if (historyBarChart) return historyBarChart;
  const canvas = $$('#historyBars'); if (!canvas) return null;
  historyBarChart = new Chart(canvas, {
    type:'bar',
    data:{labels:[],datasets:[
      {label:'Longest',data:[],backgroundColor:'#19d27c'},
      {label:'Average',data:[],backgroundColor:'#4d7cff'},
      {label:'Shortest',data:[],backgroundColor:'#ff5c5c'}
    ]},
    options:{responsive:true,scales:{y:{beginAtZero:true, title:{display:true,text:'Yards'}}}}
  });
  return historyBarChart;
}
function getClubShapesBar(){
  if (clubShapesBarChart) return clubShapesBarChart;
  const canvas = $$('#clubShapesBar'); if (!canvas) return null;
  clubShapesBarChart = new Chart(canvas, {
    type:'bar',
    data:{labels:[],datasets:[{label:'Count',data:[],backgroundColor:'#59c2ff'}]},
    options:{responsive:true,scales:{y:{beginAtZero:true}}, plugins:{legend:{display:false}}}
  });
  return clubShapesBarChart;
}
function getClubDistanceLine(){
  if (clubDistanceLineChart) return clubDistanceLineChart;
  const canvas = $$('#clubDistanceLine'); if (!canvas) return null;
  clubDistanceLineChart = new Chart(canvas, {
    type:'line',
    data:{datasets:[{label:'Distance',data:[],borderColor:'#ffaa4d',backgroundColor:'rgba(255,170,77,.15)',tension:0.25,pointRadius:3}]},
    options:{
      responsive:true, parsing:false,
      scales:{ x:{type:'time', time:{unit:'day'}}, y:{beginAtZero:true, title:{display:true,text:'Yards'}} }
    }
  });
  return clubDistanceLineChart;
}

// ---------- Aggregations (safe for free-form)
function byClub(arr){
  const m = {};
  for(const s of arr){
    const k = s.club + (s.isHybrid ? ' (Hybrid)' : '');
    (m[k] = m[k] || []).push(s);
  }
  return m;
}
const numericOnly = (arr)=>arr.map(s=>parseFloat(s.distance)).filter(n=>!isNaN(n));
function calcStats(arr){
  const nums = numericOnly(arr);
  if (!nums.length) return {avg:0, min:0, max:0, count:arr.length};
  const sum = nums.reduce((a,b)=>a+b,0);
  return {avg:+(sum/nums.length).toFixed(1), min:Math.min(...nums), max:Math.max(...nums), count:arr.length};
}
function tallyShapes(arr){
  const shapes = ['Straight','Draw','Fade','Hook','Slice','Pull','Push'];
  const map = new Map(shapes.map(s=>[s,0]));
  arr.forEach(s => map.set(s.shape, (map.get(s.shape)||0)+1));
  return map;
}

// ---------- LOGGER (session) Renders
function renderLogger(){
  // Per-club table (Average, Longest, Shortest, Swings)
  const grouped = byClub(sessionShots);
  const clubs = Object.keys(grouped).sort();
  const tbody = $$('#sessionPerClub tbody');
  if (!clubs.length){
    tbody.innerHTML = `<tr><td colspan="5">No swings this session.</td></tr>`;
  } else {
    tbody.innerHTML = clubs.map(club=>{
      const st = calcStats(grouped[club]);
      const safe = v => Number.isFinite(v) ? v : 0;
      return `<tr>
        <td>${club}</td>
        <td>${safe(st.avg)}</td>
        <td>${safe(st.max)}</td>
        <td>${safe(st.min)}</td>
        <td>${st.count}</td>
      </tr>`;
    }).join('');
  }

  // Session table (latest)
  const latestBody = $$('#latestTable tbody');
  latestBody.innerHTML = sessionShots.length
    ? [...sessionShots].slice(-50).reverse().map(s=>rowHTML(s,false,true)).join('')
    : `<tr><td colspan="6">No swings this session.</td></tr>`;
}

// ---------- HISTORY Renders (with filter + charts)
function renderHistory(){
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
  const shapeCounts = Object.fromEntries(tallyShapes(filtered));
  $$('#historyStats').innerHTML = `
    <div class="stats">
      <div class="box"><div class="label">Total</div><div class="val">${filtered.length}</div></div>
      ${Object.entries(shapeCounts).map(([k,v])=>`<div class="box"><div class="label">${k}</div><div class="val">${v}</div></div>`).join('')}
    </div>
  `;

  // Longest • Average • Shortest (bar) — for all clubs in filtered set
  const grouped = byClub(filtered);
  const clubs = Object.keys(grouped).sort();
  const longest = clubs.map(c=>calcStats(grouped[c]).max);
  const avg     = clubs.map(c=>calcStats(grouped[c]).avg);
  const shortest= clubs.map(c=>calcStats(grouped[c]).min);
  const hb = getHistoryBar();
  if (hb){
    hb.data.labels = clubs;
    hb.data.datasets[0].data = longest.map(v=>Number.isFinite(v)?v:0);
    hb.data.datasets[1].data = avg.map(v=>Number.isFinite(v)?v:0);
    hb.data.datasets[2].data = shortest.map(v=>Number.isFinite(v)?v:0);
    hb.update();
  }

  // Shot Types (bar) — for selected club or all clubs
  const clubShapes = tallyShapes(filtered);
  const csb = getClubShapesBar();
  if (csb){
    csb.data.labels = Array.from(clubShapes.keys());
    csb.data.datasets[0].data = Array.from(clubShapes.values());
    csb.update();
  }

  // Distance Trend (line) — only when a single club is selected
  const trendCard = $$('#clubTrendCard');
  const trendNote = $$('#trendNote');
  const line = getClubDistanceLine();
  if (selVal==='__all__'){
    // Hide/clear trend when not a specific club
    if (line){ line.data.datasets[0].data = []; line.update(); }
    trendNote.style.display = 'block';
  } else {
    trendNote.style.display = 'none';
    const arr = grouped[selVal] || [];
    const pts = arr
      .map(s=>({x:new Date(s.date).getTime(), y:parseFloat(s.distance)}))
      .filter(p=>!isNaN(p.y))
      .sort((a,b)=>a.x-b.x);
    if (line){
      line.data.datasets[0].data = pts;
      line.update();
    }
  }

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
  if(!dateVal || distance === ''){ toast('Fill all fields'); return; }

  sessionShots.push({
    id: uid(),
    date: new Date(dateVal).toISOString(),
    club, isHybrid, distance,
    shape: $$('#shape').value
  });
  save(STORAGE_SESSION, sessionShots);

  // Only reset distance to "0" + update date; keep club/hybrid/custom
  $$('#distance').value = "0";
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
    if(!d || dist === ''){ toast('Fill all fields ❗'); return; }
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
  $$('#distance').value='0';
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

  // Session table remove
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

  // History table: edit/delete/save/cancel
  $$('#historyTable').addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const tr = e.target.closest('tr'); if(!tr) return;
    if(btn.classList.contains('edit')) startEdit(tr);
    else if(btn.classList.contains('delete')){
      const id = tr.dataset.id;
      historyShots = historyShots.filter(s=>s.id!==id);
      save(STORAGE_HISTORY, historyShots);
      renderHistoryFiltered();
      toast('Deleted ✔️');
    }
    else if(btn.classList.contains('save')) finishEdit(tr, true);
    else if(btn.classList.contains('cancel')) renderHistoryFiltered();
  });

  // History filter dropdown
  $$('#historyClubFilter').addEventListener('change', renderHistoryFiltered);

  // Save session -> history
  $$('#saveSession').addEventListener('click', saveSessionToHistory);

  // Reset selections
  $$('#resetSelections').addEventListener('click', resetSelections);

  // Clear distance only
  $$('#clearDistance').addEventListener('click', ()=>{
    $$('#distance').value = '0';
    $$('#distance').focus();
  });

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
  $$('#distance').value = '0';
  $$('#otherClubWrap').hidden = $$('#clubType').value !== 'Other';
  renderLogger();
  renderHistory(); // prepare history filter + charts
  wire();
}

document.addEventListener('DOMContentLoaded', init);
