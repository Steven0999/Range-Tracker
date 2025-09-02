const $$ = (s, r=document)=>r.querySelector(s);
const $$$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

// Storage keys
const STORAGE_SESSION = 'drivingRange_session';
const STORAGE_HISTORY = 'drivingRange_history';

// Load/save helpers (with fallback)
function load(key){ try{ return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] } }
function save(key, data){ try{ localStorage.setItem(key, JSON.stringify(data)); } catch{} }

let sessionShots = load(STORAGE_SESSION);
let historyShots = load(STORAGE_HISTORY);

// Date helpers
const fmt = iso=>new Date(iso).toLocaleString();
const toLocal = iso=>{
  const d=new Date(iso);const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const uid=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;

function toast(msg){
  const t=$$('#toast'); if(!t) return;
  t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 1500);
}

// ---------- Charts (history only) — safe if Chart is missing
let historyBarChart, clubShapesBarChart, clubDistanceLineChart;

function hasChart(){ return typeof Chart !== 'undefined'; }

function getHistoryBar(){
  if (!hasChart()) return null;
  if (historyBarChart) return historyBarChart;
  const canvas = $$('#historyBars'); if (!canvas) return null;
  historyBarChart = new Chart(canvas, {
    type:'bar',
    data:{labels:[],datasets:[
      {label:'Longest',data:[],backgroundColor:'#19d27c'},
      {label:'Average',data:[],backgroundColor:'#4d7cff'},
      {label:'Shortest',data:[],backgroundColor:'#ff5c5c'}
    ]},
    options:{responsive:true,scales:{y:{beginAtZero:true}}}
  });
  return historyBarChart;
}
function getClubShapesBar(){
  if (!hasChart()) return null;
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
  if (!hasChart()) return null;
  if (clubDistanceLineChart) return clubDistanceLineChart;
  const canvas = $$('#clubDistanceLine'); if (!canvas) return null;
  clubDistanceLineChart = new Chart(canvas, {
    type:'line',
    data:{datasets:[{label:'Distance',data:[],borderColor:'#ffaa4d',backgroundColor:'rgba(255,170,77,.15)',tension:0.25,pointRadius:3}]},
    options:{responsive:true,parsing:false,scales:{x:{type:'time'},y:{beginAtZero:true}}}
  });
  return clubDistanceLineChart;
}

// ---------- Aggregations
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

// ---------- LOGGER (session) Renders (guarded)
function renderLogger(){
  const table = $$('#sessionPerClub tbody');
  const latestBody = $$('#latestTable tbody');
  if(!table || !latestBody) return;

  const grouped = byClub(sessionShots);
  const clubs = Object.keys(grouped).sort();

  if (!clubs.length){
    table.innerHTML = `<tr><td colspan="5">No swings this session.</td></tr>`;
  } else {
    table.innerHTML = clubs.map(club=>{
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

  latestBody.innerHTML = sessionShots.length
    ? [...sessionShots].slice(-50).reverse().map(s=>rowHTML(s,false,true)).join('')
    : `<tr><td colspan="6">No swings this session.</td></tr>`;
}

// ---------- HISTORY Renders (guarded)
function renderHistory(){
  const sel = $$('#historyClubFilter');
  if(!sel) return;
  const grouped = byClub(historyShots);
  const clubs = Object.keys(grouped).sort();
  const prev = sel.value || '__all__';
  sel.innerHTML = `<option value="__all__">All Clubs</option>` + clubs.map(c=>`<option>${c}</option>`).join('');
  sel.value = clubs.includes(prev) ? prev : '__all__';
  renderHistoryFiltered();
}

function renderHistoryFiltered(){
  const sel = $$('#historyClubFilter');
  const statsBox = $$('#historyStats');
  const tableBody = $$('#historyTable tbody');
  if(!sel || !statsBox || !tableBody) return;

  const selVal = sel.value;
  const filtered = selVal==='__all__' ? historyShots : (byClub(historyShots)[selVal] || []);

  // Stats boxes
  const shapeCounts = Object.fromEntries(tallyShapes(filtered));
  statsBox.innerHTML = `
    <div class="stats">
      <div class="box"><div class="label">Total</div><div class="val">${filtered.length}</div></div>
      ${Object.entries(shapeCounts).map(([k,v])=>`<div class="box"><div class="label">${k}</div><div class="val">${v}</div></div>`).join('')}
    </div>
  `;

  // Longest • Average • Shortest chart (filtered)
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

  // Shot types bar (filtered)
  const csb = getClubShapesBar();
  if (csb){
    const tallied = tallyShapes(filtered);
    csb.data.labels = Array.from(tallied.keys());
    csb.data.datasets[0].data = Array.from(tallied.values());
    csb.update();
  }

  // Line trend — only when one club selected
  const trendNote = $$('#trendNote');
  const line = getClubDistanceLine();
  if (selVal==='__all__'){
    if (trendNote) trendNote.style.display = 'block';
    if (line){ line.data.datasets[0].data = []; line.update(); }
  } else {
    if (trendNote) trendNote.style.display = 'none';
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
  tableBody.innerHTML = filtered.length
    ? filtered.map(s=>rowHTML(s,true,false)).join('')
    : `<tr><td colspan="6">No saved swings${selVal!=='__all__'?' for this club':''}.</td></tr>`;
}

// ---------- Row HTML
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
          <button class="btn edit" type="button">Edit</button>
          <button class="btn danger delete" type="button">Delete</button>
        ` : isSession ? `
          <button class="btn danger delete-session" type="button">Remove</button>
        ` : ``}
      </td>
    </tr>
  `;
}

// ---------- Form submit (SESSION ONLY)
function onSubmit(e){
  e.preventDefault();
  const clubType=$$('#clubType')?.value;
  const isHybrid=$$('#isHybrid')?.checked;
  const other=$$('#otherClub')?.value.trim();
  const distance=$$('#distance')?.value.trim();
  const dateVal=$$('#date')?.value;
  if (!clubType || !dateVal || distance === undefined || distance === ''){
    toast('Fill all fields'); return;
  }
  const club = clubType==='Other' ? (other || 'Other') : clubType;

  sessionShots.push({
    id: uid(),
    date: new Date(dateVal).toISOString(),
    club, isHybrid, distance,
    shape: $$('#shape')?.value || 'Straight'
  });
  save(STORAGE_SESSION, sessionShots);

  // Reset distance to "0" and refresh date
  if ($$('#distance')) $$('#distance').value = '0';
  if ($$('#date')) $$('#date').value = toLocal(new Date().toISOString());

  renderLogger();
  toast('Swing added ✔️');
  $$('#distance')?.focus();
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
    <td><button class="btn save" type="button">Save</button> <button class="btn cancel" type="button">Cancel</button></td>
  `;
}
function finishEdit(tr, saveIt){
  const id = tr.dataset.id;
  const idx = historyShots.findIndex(x=>x.id === id);
  if(idx<0) return;

  if(saveIt){
    const d = tr.querySelector('.e-date')?.value;
    const dist = tr.querySelector('.e-dist')?.value.trim();
    const sh = tr.querySelector('.e-shape')?.value;
    if(!d || dist === ''){ toast('Fill all fields ❗'); return; }
    historyShots[idx].date = new Date(d).toISOString();
    historyShots[idx].distance = dist;
    historyShots[idx].shape = sh || historyShots[idx].shape;
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
  if ($$('#clubType')) $$('#clubType').value='Driver';
  if ($$('#isHybrid')) $$('#isHybrid').checked=false;
  if ($$('#otherClub')) $$('#otherClub').value='';
  if ($$('#otherClubWrap')) $$('#otherClubWrap').hidden=true;
  if ($$('#distance')) $$('#distance').value='0';
  if ($$('#shape')) $$('#shape').value='Straight';
  if ($$('#date')) $$('#date').value=toLocal(new Date().toISOString());
  toast('Selections reset ✔️');
  $$('#distance')?.focus();
}

// ---------- Wiring
function wire(){
  // Nav
  $$$('.nav__btn').forEach(btn => btn.addEventListener('click', ()=>{
    $$$('.view').forEach(v=>v.classList.remove('view--active'));
    $$('#'+btn.dataset.target)?.classList.add('view--active');
    $$$('.nav__btn').forEach(x=>x.setAttribute('aria-selected', x===btn?'true':'false'));
    if(btn.dataset.target==='historyView'){ renderHistory(); } else { renderLogger(); }
  }));
  // Back button
  $$$('[data-target="loggerView"]').forEach(b=>b.addEventListener('click', ()=>$$('.nav__btn[data-target="loggerView"]')?.click()));

  // Form
  $$('#swingForm')?.addEventListener('submit', onSubmit);
  $$('#clubType')?.addEventListener('change', ()=>{
    if ($$('#otherClubWrap')) $$('#otherClubWrap').hidden = $$('#clubType').value !== 'Other';
  });

  // Session table remove
  $$('#latestTable')?.addEventListener('click', e=>{
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
  $$('#historyTable')?.addEventListener('click', e=>{
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
  $$('#historyClubFilter')?.addEventListener('change', renderHistoryFiltered);

  // Save session -> history
  $$('#saveSession')?.addEventListener('click', saveSessionToHistory);

  // Reset selections
  $$('#resetSelections')?.addEventListener('click', resetSelections);

  // Clear distance only
  $$('#clearDistance')?.addEventListener('click', ()=>{
    if ($$('#distance')) { $$('#distance').value = '0'; $$('#distance').focus(); }
  });

  // Reset all data
  $$('#resetAll')?.addEventListener('click', ()=>{
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
  try{
    if ($$('#date')) $$('#date').value = toLocal(new Date().toISOString());
    if ($$('#distance')) $$('#distance').value = '0';
    if ($$('#otherClubWrap')) $$('#otherClubWrap').hidden = $$('#clubType')?.value !== 'Other';
    renderLogger();
    renderHistory(); // prepares history UI safely even if charts unavailable
    wire();
  } catch(err){
    console.error(err);
    toast('Init error — check console');
  }
}

document.addEventListener('DOMContentLoaded', init);
