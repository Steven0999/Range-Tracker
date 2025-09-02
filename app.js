/* Driving Range Tracker
   Data stays in localStorage. No backend. */

// ===== Utilities =====
const $$ = (sel, root = document) => root.querySelector(sel);
const $$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmtDate = (iso) => new Date(iso).toLocaleString();
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const STORAGE_KEY = 'drivingRangeShotsV1';

function loadShots(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; }
  catch { return []; }
}
function saveShots(shots){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shots));
}

let shots = loadShots();

// ===== Routing =====
function showView(id){
  $$$('.view').forEach(v => v.classList.remove('view--active'));
  $$('#' + id).classList.add('view--active');
  // nav state
  $$$('.nav__btn').forEach(b => b.setAttribute('aria-selected', b.dataset.target === id ? 'true' : 'false'));
  if(id === 'historyView'){ renderHistory(); } else { renderLoggerSide(); }
}

// ===== Toast =====
let toastTimer;
function toast(msg){
  const el = $$('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 1800);
}

// ===== Charts =====
let clubBarsChart, trendChart, shapesChart;

function ensureClubBarsChart(ctx){
  if (clubBarsChart) clubBarsChart.destroy();
  clubBarsChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: false, ticks: { color: '#cfe3ff' } },
        y: { beginAtZero: true, ticks: { color: '#cfe3ff' }, title: { display:true, text:'Yards' } },
      },
      plugins: {
        legend: { labels: { color: '#cfe3ff' } },
        tooltip: { mode: 'index', intersect: false }
      }
    }
  });
}

function ensureTrendChart(ctx){
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: { type: 'time', time: { unit: 'day' }, ticks: { color:'#cfe3ff' }, title: { display:true, text:'Date' } },
        y: { beginAtZero: true, ticks: { color:'#cfe3ff' }, title: { display:true, text:'Yards' } }
      },
      plugins:{
        legend: { labels: { color:'#cfe3ff' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.label === 'Trend') return ` Trend: ${ctx.raw.y.toFixed(1)} yds`;
              const s = ctx.raw.meta;
              return ` ${s.club}${s.isHybrid?' (Hybrid)':''} — ${s.distance} yds`;
            }
          }
        }
      }
    }
  });
}

function ensureShapesChart(ctx){
  if (shapesChart) shapesChart.destroy();
  shapesChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: ['#17d27c','#ff5c5c','#4d7cff','#ffaa4d','#8f6bff','#40e0d0','#ffd700'] }] },
    options: {
      responsive: true, maintainAspectRatio:false,
      plugins: { legend: { labels: { color:'#cfe3ff' } } }
    }
  });
}

// ===== Aggregations =====
function groupByClub(data = shots){
  const map = new Map();
  data.forEach(s => {
    const key = s.club + (s.isHybrid ? ' (Hybrid)' : '');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });
  return map;
}

function statsFor(arr){
  if (!arr.length) return { count:0, avg:0, min:0, max:0 };
  const distances = arr.map(s => s.distance);
  const sum = distances.reduce((a,b)=>a+b,0);
  return {
    count: arr.length,
    avg: +(sum/arr.length).toFixed(1),
    min: Math.min(...distances),
    max: Math.max(...distances)
  };
}

function shapesTally(data = shots){
  const tally = new Map();
  data.forEach(s => tally.set(s.shape, (tally.get(s.shape)||0)+1));
  return tally;
}

// Simple linear regression y = a + b*x
function linearRegression(points){ // points: [{x: timestamp, y: distance}]
  if (points.length < 2) return null;
  const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
  const n = points.length;
  const mean = (a) => a.reduce((s,v)=>s+v,0)/a.length;
  const xbar = mean(xs), ybar = mean(ys);
  let num=0, den=0;
  for(let i=0;i<n;i++){ num += (xs[i]-xbar)*(ys[i]-ybar); den += (xs[i]-xbar)**2; }
  const b = den === 0 ? 0 : num/den;
  const a = ybar - b*xbar;
  // Build two end points for the chart (minX, maxX)
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  return { a, b, line: [{x:minX, y:a+b*minX}, {x:maxX, y:a+b*maxX}] };
}

// ===== Renders =====
function renderLoggerSide(){
  // Session summary (last 10 swings)
  const recent = [...shots].sort((a,b)=> b.date.localeCompare(a.date)).slice(0, 10);
  const sum = statsFor(recent);
  const straight = recent.filter(s=>s.shape==='Straight').length;
  const hooks = recent.filter(s=>s.shape==='Hook').length;
  const slices = recent.filter(s=>s.shape==='Slice').length;
  const wrap = $$('#sessionSummary');
  wrap.innerHTML = `
    <div class="summary-item"><h4>Recent Avg</h4><div class="val">${sum.avg} yds</div></div>
    <div class="summary-item"><h4>Best (10)</h4><div class="val">${sum.max||0} yds</div></div>
    <div class="summary-item"><h4>Worst (10)</h4><div class="val">${sum.min||0} yds</div></div>
    <div class="summary-item"><h4>Shapes (10)</h4><div class="val">S:${straight} • H:${hooks} • Sl:${slices}</div></div>
  `;

  // Per-club grouped bars
  const map = groupByClub();
  const clubs = [...map.keys()].sort((a,b)=> a.localeCompare(b));
  const best = clubs.map(c => statsFor(map.get(c)).max);
  const avg  = clubs.map(c => statsFor(map.get(c)).avg);
  const worst= clubs.map(c => {
    const st = statsFor(map.get(c));
    return st.min || 0;
  });

  const ctxBars = $$('#clubBars').getContext('2d');
  ensureClubBarsChart(ctxBars);
  clubBarsChart.data.labels = clubs;
  clubBarsChart.data.datasets = [
    { label:'Best', data:best, backgroundColor:'#17d27c' },
    { label:'Average', data:avg, backgroundColor:'#4d7cff' },
    { label:'Worst', data:worst, backgroundColor:'#ff5c5c' }
  ];
  clubBarsChart.update();

  // Trend chart default to first club with data
  const trendSelect = $$('#trendClub');
  trendSelect.innerHTML = clubs.map(c => `<option value="${c}">${c}</option>`).join('') || `<option value="">No data yet</option>`;
  if (clubs.length){
    if (!trendSelect.value) trendSelect.value = clubs[0];
    renderTrend(trendSelect.value);
  } else {
    const ctxTrend = $$('#trendChart').getContext('2d');
    ensureTrendChart(ctxTrend);
    trendChart.data.datasets = [];
    trendChart.update();
  }

  // Latest table
  renderLatestTable();
}

function renderTrend(clubKey){
  const ctx = $$('#trendChart').getContext('2d');
  ensureTrendChart(ctx);

  const map = groupByClub();
  const arr = map.get(clubKey) || [];
  const points = arr.map(s => ({
    x: new Date(s.date).getTime(),
    y: s.distance,
    meta: s
  })).sort((a,b)=> a.x - b.x);

  const reg = linearRegression(points);
  trendChart.data.datasets = [
    {
      type:'scatter',
      label:'Swings',
      data: points,
      borderColor:'#2ea8e8',
      backgroundColor:'#2ea8e8',
      pointRadius:4,
    }
  ];
  if (reg){
    trendChart.data.datasets.push({
      type:'line',
      label:'Trend',
      data: reg.line,
      borderColor:'#ffaa4d',
      borderWidth:2,
      fill:false,
      pointRadius:0,
      tension:0
    });
  }
  trendChart.update();
}

function renderLatestTable(){
  const tbody = $$('#latestTable tbody');
  const rows = [...shots].sort((a,b)=> b.date.localeCompare(a.date)).slice(0, 12);
  tbody.innerHTML = rows.map(s => rowHTML(s, false)).join('') || `<tr><td colspan="6" class="muted">No swings yet. Add your first above 💡</td></tr>`;
}

function renderHistory(){
  // Totals
  $$('#totalSwings').textContent = shots.length;
  const tally = shapesTally();
  $$('#totalStraight').textContent = tally.get('Straight') || 0;
  $$('#totalHook').textContent = tally.get('Hook') || 0;
  $$('#totalSlice').textContent = tally.get('Slice') || 0;

  // Shapes chart
  const labels = Array.from(tally.keys()).sort();
  const data = labels.map(k => tally.get(k));
  const ctx = $$('#shapesChart').getContext('2d');
  ensureShapesChart(ctx);
  shapesChart.data.labels = labels;
  shapesChart.data.datasets[0].data = data;
  shapesChart.update();

  // Full table
  const tbody = $$('#historyTable tbody');
  const rows = [...shots].sort((a,b)=> b.date.localeCompare(a.date));
  tbody.innerHTML = rows.map(s => rowHTML(s, true)).join('') || `<tr><td colspan="6" class="muted">No swings in history.</td></tr>`;
}

function rowHTML(s, withActions){
  const hybrid = s.isHybrid ? 'Yes' : 'No';
  return `
    <tr data-id="${s.id}">
      <td>${fmtDate(s.date)}</td>
      <td>${s.club}</td>
      <td>${hybrid}</td>
      <td class="distance-cell">${s.distance}</td>
      <td class="shape-cell">${s.shape}</td>
      <td>
        ${withActions ? `
          <div class="row">
            <button class="btn btn--sm edit">Edit</button>
            <button class="btn btn--sm danger delete">Delete</button>
          </div>
        ` : ''}
      </td>
    </tr>
  `;
}

// ===== Editing (inline) =====
function beginEdit(tr){
  const id = tr.dataset.id;
  const s = shots.find(x => x.id === id);
  if (!s) return;

  tr.innerHTML = `
    <td><input type="datetime-local" class="edit-date" value="${toLocalDatetimeValue(s.date)}"></td>
    <td>${s.club}</td>
    <td>${s.isHybrid ? 'Yes' : 'No'}</td>
    <td><input type="number" class="edit-distance" min="1" step="1" value="${s.distance}"></td>
    <td>
      <select class="edit-shape">
        ${['Straight','Draw','Fade','Hook','Slice','Pull','Push'].map(v=>`<option ${s.shape===v?'selected':''}>${v}</option>`).join('')}
      </select>
    </td>
    <td>
      <div class="row">
        <button class="btn btn--sm primary save">Save</button>
        <button class="btn btn--sm cancel">Cancel</button>
      </div>
    </td>
  `;
}

function toLocalDatetimeValue(iso){
  // Convert ISO string to value for input[type="datetime-local"]
  const d = new Date(iso);
  const pad = (n)=> String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function finishEdit(tr, saveChanges){
  const id = tr.dataset.id;
  const idx = shots.findIndex(x => x.id === id);
  if (idx === -1) return;

  if (saveChanges){
    const dateVal = tr.querySelector('.edit-date').value;
    const distVal = +tr.querySelector('.edit-distance').value;
    const shapeVal = tr.querySelector('.edit-shape').value;
    if (!dateVal || !distVal || distVal < 1){
      toast('Please enter a valid date and distance ❗');
      return;
    }
    shots[idx].date = new Date(dateVal).toISOString();
    shots[idx].distance = Math.round(clamp(distVal, 1, 2000));
    shots[idx].shape = shapeVal;
    saveShots(shots);
    toast('Swing updated ✔️');
  }

  // Re-render both tables and charts/statistics
  renderHistory();
  renderLoggerSide();
}

// ===== Form handling =====
function onFormSubmit(e){
  e.preventDefault();
  const clubType = $$('#clubType').value;
  const isHybrid = $$('#isHybrid').checked;
  const otherClub = $$('#otherClub').value.trim();
  const club = clubType === 'Other' ? (otherClub || 'Other') : clubType;

  const distance = Math.round(+$$('#distance').value);
  const shape = $$('#shape').value;
  const dateVal = $$('#date').value;

  if (!distance || distance < 1 || !dateVal){
    toast('Please enter a valid distance and date ❗');
    return;
  }

  const swing = {
    id: uid(),
    date: new Date(dateVal).toISOString(),
    club,
    isHybrid,
    distance,
    shape
  };

  shots.push(swing);
  saveShots(shots);
  e.target.reset();
  // Reset dependent UI
  $$('#otherClubWrap').hidden = true;
  $$('#clubType').value = 'Driver';
  $$('#shape').value = 'Straight';
  $$('#date').value = toLocalDatetimeValue(new Date().toISOString());

  renderLoggerSide();
  toast('Swing added ✔️');
}

function onClubTypeChange(){
  const isOther = $$('#clubType').value === 'Other';
  $$('#otherClubWrap').hidden = !isOther;
  if (isOther) $$('#otherClub').focus();
}

function onTrendClubChange(){
  const club = $$('#trendClub').value;
  if (club) renderTrend(club);
}

// ===== Event wiring =====
function wireEvents(){
  // Top nav
  $$$('.nav__btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.target)));
  // History back button
  $$$('#historyView .btn').forEach(btn => {
    if (btn.dataset.target) btn.addEventListener('click', () => showView(btn.dataset.target));
  });
  // Form
  $$('#swingForm').addEventListener('submit', onFormSubmit);
  $$('#swingForm').addEventListener('reset', () => setTimeout(()=> $$('#distance').focus(), 0));
  $$('#clubType').addEventListener('change', onClubTypeChange);
  $$('#trendClub').addEventListener('change', onTrendClubChange);

  // Edit/Delete in history table (event delegation)
  $$('#historyTable').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tr = e.target.closest('tr');
    if (!tr) return;

    if (btn.classList.contains('edit')) beginEdit(tr);
    if (btn.classList.contains('delete')) {
      const id = tr.dataset.id;
      shots = shots.filter(s => s.id !== id);
      saveShots(shots);
      renderHistory();
      renderLoggerSide();
      toast('Deleted ✔️');
    }
    if (btn.classList.contains('save')) finishEdit(tr, true);
    if (btn.classList.contains('cancel')) renderHistory();
  });

  // Reset all
  $$('#resetAll').addEventListener('click', () => {
    if (confirm('Delete ALL swings from this browser?')) {
      shots = [];
      saveShots(shots);
      renderHistory();
      renderLoggerSide();
      toast('All data cleared');
    }
  });
}

// ===== Init =====
function init(){
  // default date input = now
  const nowIso = new Date().toISOString();
  $$('#date').value = toLocalDatetimeValue(nowIso);

  // First render
  renderLoggerSide();
  wireEvents();
}

document.addEventListener('DOMContentLoaded', init);
