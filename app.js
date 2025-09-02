/* History charts restored + robust guards */
const $$  = (s, r=document)=>r.querySelector(s);
const $$$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

/* ---------- Safe storage (fallback to memory if localStorage blocked) ---------- */
const STORAGE_SESSION = 'drivingRange_session';
const STORAGE_HISTORY = 'drivingRange_history';
const mem = { [STORAGE_SESSION]: [], [STORAGE_HISTORY]: [] };

function canStore(){
  try{ localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; }catch{ return false; }
}
const HAS_LS = canStore();

function load(key){
  if (!HAS_LS) return mem[key] || [];
  try{ return JSON.parse(localStorage.getItem(key)) || [] } catch { return []; }
}
function save(key, data){
  if (!HAS_LS){ mem[key] = data; return; }
  try{ localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

/* ---------- Model ---------- */
let sessionShots = load(STORAGE_SESSION);
let historyShots = load(STORAGE_HISTORY);

/* ---------- Utils ---------- */
const fmt = iso=> new Date(iso).toLocaleString();
const toLocal = iso=>{
  const d = new Date(iso); const p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const uid = ()=> `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const parseNums = arr => arr.map(s=>parseFloat(s.distance)).filter(n=>!isNaN(n));
function stats(arr){
  const nums = parseNums(arr);
  if(!nums.length) return { avg:0, min:0, max:0, count:arr.length };
  const sum = nums.reduce((a,b)=>a+b,0);
  return { avg:+(sum/nums.length).toFixed(1), min:Math.min(...nums), max:Math.max(...nums), count:arr.length };
}
function byClub(arr){
  const m = {};
  for(const s of arr){
    const k = s.club + (s.isHybrid ? ' (Hybrid)' : '');
    (m[k] = m[k] || []).push(s);
  }
  return m;
}
function tallyShapes(arr){
  const shapes = ['Straight','Draw','Fade','Hook','Slice','Pull','Push'];
  const map = new Map(shapes.map(s=>[s,0]));
  arr.forEach(s => map.set(s.shape, (map.get(s.shape)||0)+1));
  return map;
}
function toast(msg){
  const t=$$('#toast'); if(!t) return;
  t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 1400);
}

/* ---------- Charts (History only) ---------- */
const hasChart = ()=> typeof Chart !== 'undefined';
let historyBarChart, clubShapesBarChart, clubDistanceLineChart;

function getHistoryBar(){
  if (!hasChart()) { $$('#barNote')?.style && ($$('#barNote').style.display='block'); return null; }
  if (historyBarChart) return historyBarChart;
  const ctx = $$('#historyBars'); if(!ctx) return null;
  historyBarChart = new Chart(ctx, {
    type:'bar',
    data:{labels:[],datasets:[
      {label:'Longest',data:[],backgroundColor:'#19d27c'},
      {label:'Average',data:[],backgroundColor:'#4d7cff'},
      {label:'Shortest',data:[],backgroundColor:'#ff5c5c'}
    ]},
    options:{responsive:true,scales:{y:{beginAtZero:true,title:{display:true,text:'Yards'}}}}
  });
  return historyBarChart;
}
function getClubShapesBar(){
  if (!hasChart()) { $$('#shapesNote')?.style && ($$('#shapesNote').style.display='block'); return null; }
  if (clubShapesBarChart) return clubShapesBarChart;
  const ctx = $$('#clubShapesBar'); if(!ctx) return null;
  clubShapesBarChart = new Chart(ctx, {
    type:'bar',
    data:{labels:[],datasets:[{label:'Count',data:[],backgroundColor:'#59c2ff'}]},
    options:{responsive:true,scales:{y:{beginAtZero:true}},plugins:{legend:{display:false}}}
  });
  return clubShapesBarChart;
}
function getClubDistanceLine(){
  if (!hasChart()) { $$('#lineNote')?.style && ($$('#lineNote').style.display='block'); return null; }
  if (clubDistanceLineChart) return clubDistanceLineChart;
  const ctx = $$('#clubDistanceLine'); if(!ctx) return null;
  clubDistanceLineChart = new Chart(ctx, {
    type:'line',
    data:{datasets:[{label:'Distance',data:[],borderColor:'#ffaa4d',backgroundColor:'rgba(255,170,77,.15)',tension:0.25,pointRadius:3}]},
    options:{responsive:true,parsing:false,scales:{x:{type:'time',time:{unit:'day'}},y:{beginAtZero:true,title:{display:true,text:'Yards'}}}}
  });
  return clubDistanceLineChart;
}

/* ---------- Rendering: Logger ---------- */
function renderLogger(){
  const perClubBody = $$('#sessionPerClub tbody');
  const latestBody  = $$('#latestTable tbody');
  if(!perClubBody || !latestBody) return;

  const grouped = byClub(sessionShots);
  const clubs = Object.keys(grouped).sort();
  if(!clubs.length){
    perClubBody.innerHTML = `<tr><td colspan="5">No swings this session.</td></tr>`;
  }else{
    perClubBody.innerHTML = clubs.map(c=>{
      const st = stats(grouped[c]);
      const safe = v => Number.isFinite(v)? v : 0;
      return `<tr>
        <td>${c}</td>
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

/* ---------- Rendering: History (with charts) ---------- */
function renderHistory(){
  const sel = $$('#historyClubFilter'); if(!sel) return;
  const grouped = byClub(historyShots);
  const clubs = Object.keys(grouped).sort();
  const prev = sel.value || '__all__';
  sel.innerHTML = `<option value="__all__">All Clubs</option>` + clubs.map(c=>`<option>${c}</option>`).join('');
  sel.value = clubs.includes(prev) ? prev : '__all__';

  renderHistoryFiltered();
}

function renderHistoryFiltered(){
  const sel = $$('#historyClubFilter'); if(!sel) return;
  const tbody = $$('#historyTable tbody'); if(!tbody) return;

  const selVal = sel.value;
  const filtered = selVal==='__all__' ? historyShots : (byClub(historyShots)[selVal] || []);

  // Update bar: per-club Longest / Average / Shortest (for filtered set)
  const grouped = byClub(filtered);
  const clubs = Object.keys(grouped).sort();
  const longest = clubs.map(c=>stats(grouped[c]).max);
  const average = clubs.map(c=>stats(grouped[c]).avg);
  const shortest= clubs.map(c=>stats(grouped[c]).min);

  const hb = getHistoryBar();
  if (hb){
    hb.data.labels = clubs;
    hb.data.datasets[0].data = longest.map(v=>Number.isFinite(v)?v:0);
    hb.data.datasets[1].data = average.map(v=>Number.isFinite(v)?v:0);
    hb.data.datasets[2].data = shortest.map(v=>Number.isFinite(v)?v:0);
    hb.update();
  }

  // Update shot-types bar (for selected club or All)
  const tallied = tallyShapes(filtered);
  const csb = getClubShapesBar();
  if (csb){
    csb.data.labels = Array.from(tallied.keys());
    csb.data.datasets[0].data = Array.from(tallied.values());
    csb.update();
  }

  // Update line (only when specific club selected)
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

  // Table rows (filtered)
  tbody.innerHTML = filtered.length
    ? filtered.map(s=>rowHTML(s,true,false)).join('')
    : `<tr><td colspan="6">No saved swings${selVal!=='__all__'?' for this club':''}.</td></tr>`;
}

/* ---------- Row rendering ---------- */
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

/* ---------- Handlers ---------- */
function onSubmit(e){
  e.preventDefault();
  const clubType = $$('#clubType')?.value;
  const isHybrid = $$('#isHybrid')?.checked || false;
  const other    = $$('#otherClub')?.value.trim() || '';
  const distance = $$('#distance')?.value.trim() ?? '';
  const dateVal  = $$('#date')?.value;
  if(!clubType || !dateVal || distance===''){ toast('Fill all fields'); return; }

  const club = clubType==='Other' ? (other || 'Other') : clubType;
  const shot = {
    id: uid(),
    date: new Date(dateVal).toISOString(),
    club, isHybrid, distance,
    shape: $$('#shape')?.value || 'Straight'
  };

  sessionShots.push(shot);
  save(STORAGE_SESSION, sessionShots);

  if ($$('#distance')) $$('#distance').value = '0';
  if ($$('#date'))     $$('#date').value     = toLocal(new Date().toISOString());

  renderLogger();
  toast('Swing added ✔️');
  $$('#distance')?.focus();
}

function saveSessionToHistory(){
  if(!sessionShots.length){ toast('Nothing to save'); return; }
  historyShots = historyShots.concat(sessionShots);
  save(STORAGE_HISTORY, historyShots);
  sessionShots = [];
  save(STORAGE_SESSION, sessionShots);
  renderLogger();
  renderHistory();
  toast('Session saved to History ✔️');
}

function resetSelections(){
  if ($$('#clubType')) $$('#clubType').value = 'Driver';
  if ($$('#isHybrid')) $$('#isHybrid').checked = false;
  if ($$('#otherClub')) $$('#otherClub').value = '';
  if ($$('#otherClubWrap')) $$('#otherClubWrap').hidden = true;
  if ($$('#distance')) $$('#distance').value = '0';
  if ($$('#shape')) $$('#shape').value = 'Straight';
  if ($$('#date')) $$('#date').value = toLocal(new Date().toISOString());
  toast('Selections reset ✔️');
  $$('#distance')?.focus();
}

/* ---------- Hash Router ---------- */
function showFromHash(){
  const hash = location.hash || '#logger';
  const targetId = hash.replace('#','');
  $$$('.view').forEach(v=>v.classList.remove('view--active'));
  const active = document.getElementById(targetId) || document.getElementById('logger');
  if (active) active.classList.add('view--active');

  $$$('.nav__btn').forEach(a=>{
    const isActive = a.getAttribute('href') === `#${active?.id}`;
    a.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  if(active?.id === 'history') renderHistory(); else renderLogger();
}

/* ---------- Wiring ---------- */
function wire(){
  window.addEventListener('hashchange', showFromHash);

  $$('#swingForm')?.addEventListener('submit', onSubmit);
  $$('#clubType')?.addEventListener('change', ()=>{
    if ($$('#otherClubWrap')) $$('#otherClubWrap').hidden = $$('#clubType').value !== 'Other';
  });

  $$('#saveSession')?.addEventListener('click', saveSessionToHistory);
  $$('#resetSelections')?.addEventListener('click', resetSelections);
  $$('#clearDistance')?.addEventListener('click', ()=>{ if($$('#distance')){ $$('#distance').value='0'; $$('#distance').focus(); }});
  $$('#resetAll')?.addEventListener('click', ()=>{
    if(confirm('Delete ALL swings (session + history)?')){
      sessionShots=[]; historyShots=[];
      save(STORAGE_SESSION, sessionShots);
      save(STORAGE_HISTORY, historyShots);
      renderLogger(); renderHistory();
      toast('All data cleared');
    }
  });

  $$('#latestTable')?.addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    if(!btn.classList.contains('delete-session')) return;
    const tr = e.target.closest('tr'); if(!tr) return;
    const id = tr.dataset.id;
    sessionShots = sessionShots.filter(s=>s.id!==id);
    save(STORAGE_SESSION, sessionShots);
    renderLogger();
    toast('Removed from session ✔️');
  });

  $$('#historyTable')?.addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const tr = e.target.closest('tr'); if(!tr) return;
    const id = tr.dataset.id;

    if(btn.classList.contains('delete')){
      historyShots = historyShots.filter(s=>s.id!==id);
      save(STORAGE_HISTORY, historyShots);
      renderHistoryFiltered();
      toast('Deleted ✔️');
    }else if(btn.classList.contains('edit')){
      const s = historyShots.find(x=>x.id===id); if(!s) return;
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
        <td>
          <button class="btn save" type="button">Save</button>
          <button class="btn cancel" type="button">Cancel</button>
        </td>
      `;
    }else if(btn.classList.contains('save')){
      const d = tr.querySelector('.e-date')?.value;
      const dist = tr.querySelector('.e-dist')?.value.trim() ?? '';
      const sh = tr.querySelector('.e-shape')?.value;
      if(!d || dist===''){ toast('Fill all fields ❗'); return; }
      const idx = historyShots.findIndex(x=>x.id===id); if(idx<0) return;
      historyShots[idx].date = new Date(d).toISOString();
      historyShots[idx].distance = dist;
      historyShots[idx].shape = sh || historyShots[idx].shape;
      save(STORAGE_HISTORY, historyShots);
      renderHistoryFiltered();
      toast('Saved ✔️');
    }else if(btn.classList.contains('cancel')){
      renderHistoryFiltered();
    }
  });

  $$('#historyClubFilter')?.addEventListener('change', renderHistoryFiltered);
}

/* ---------- Init ---------- */
function init(){
  if ($$('#date')) $$('#date').value = toLocal(new Date().toISOString());
  if ($$('#distance')) $$('#distance').value = '0';
  if ($$('#otherClubWrap')) $$('#otherClubWrap').hidden = $$('#clubType')?.value !== 'Other';

  showFromHash();
  renderLogger();
  renderHistory();
  wire();
}

document.addEventListener('DOMContentLoaded', () => {
  try { init(); }
  catch (err) {
    console.error('Init failure:', err);
    alert('Init error: see console for details');
  }
});
