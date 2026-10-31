'use strict';
/* Forge workout tracker. Everything is stored on the device (localStorage). */

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;
const DAY = 864e5, KEY = 'forge.v1', LB = 2.20462, MI = 1.609344;

/* ---------- state ---------- */
const defaults = () => ({
  v: 1,
  settings: { name: '', unit: 'kg', dist: 'km', rest: 90, goal: 4, haptics: true, sound: true, autoRest: true, wake: true, hideInstall: false, theme: 'auto', onboarded: false, lastBackup: 0, backupSnooze: 0 },
  custom: [],
  routines: ROUTINE_SEED.map(r => ({ id: uid(), name: r.name, items: r.items.map(([exId, sets]) => ({ exId, sets })) })),
  workouts: [],
  body: [],
  active: null,
});
// Every value that reaches the screen unescaped (ids, enums, numbers) is validated here, both for the app's own
// storage and for backup files, so a damaged or tampered file can never inject markup or break charts.
const SAFE_ID = /^[\w-]{1,64}$/;
const num = (v, min = 0, max = 1e7) => typeof v === 'number' && isFinite(v) && v >= min ? Math.min(v, max) : null;
const str = (v, n = 200) => typeof v === 'string' ? v.slice(0, n) : '';
const oneOf = (v, list, d) => list.includes(v) ? v : d;
function cleanSets(sets) {
  return (Array.isArray(sets) ? sets : []).filter(s => s && typeof s === 'object').map(s => ({
    t: oneOf(s.t, ['n', 'w', 'd', 'f'], 'n'), w: num(s.w), r: num(s.r, 0, 1e4), sec: num(s.sec, 0, 864e2), dist: num(s.dist, 0, 1e4),
    inc: num(s.inc, 0, 40), lvl: num(s.lvl, 0, 30), done: s.done === true, pr: s.pr === true,
  }));
}
const cleanExs = exs => (Array.isArray(exs) ? exs : []).filter(e => e && SAFE_ID.test(e.exId)).map(e => ({ exId: e.exId, note: str(e.note, 300), rest: num(e.rest, 0, 3600), sets: cleanSets(e.sets) }));
function sanitize(d) {
  const b = defaults(), s = { ...b.settings }, ds = d.settings && typeof d.settings === 'object' ? d.settings : {};
  for (const k of ['haptics', 'sound', 'autoRest', 'wake', 'hideInstall', 'onboarded']) if (typeof ds[k] === 'boolean') s[k] = ds[k];
  s.name = str(ds.name, 24); s.unit = oneOf(ds.unit, ['kg', 'lb'], 'kg'); s.dist = oneOf(ds.dist, ['km', 'mi'], 'km'); s.theme = oneOf(ds.theme, ['auto', 'light', 'dark'], 'auto');
  s.rest = num(ds.rest, 0, 600) ?? b.settings.rest; s.goal = Math.round(num(ds.goal, 1, 14) ?? b.settings.goal);
  s.lastBackup = num(ds.lastBackup) ?? 0; s.backupSnooze = num(ds.backupSnooze) ?? 0;
  const workouts = (Array.isArray(d.workouts) ? d.workouts : []).filter(w => w && num(w.start, 1) && num(w.end, 1)).map(w => ({
    id: SAFE_ID.test(w.id) ? w.id : uid(), name: str(w.name, 60) || 'Workout', start: w.start, end: Math.max(w.start, w.end), rest: num(w.rest, 0, 864e2) || 0,
    notes: str(w.notes, 2000), routineId: SAFE_ID.test(w.routineId) ? w.routineId : null, exercises: cleanExs(w.exercises), prs: [],
  })).sort((a, b) => a.start - b.start);
  const custom = (Array.isArray(d.custom) ? d.custom : []).filter(c => c && SAFE_ID.test(c.id) && !EXERCISES.some(e => e.id === c.id)).map(c => ({
    id: c.id, name: str(c.name, 40) || 'Custom exercise', equip: str(c.equip, 24) || 'Other', muscle: oneOf(c.muscle, Object.keys(MUSCLES), 'Core'),
    type: oneOf(c.type, Object.keys(TYPES), 'w'), extra: c.type === 'c' ? oneOf(c.extra, Object.keys(EXTRAS), null) : null, custom: true,
  }));
  const routines = Array.isArray(d.routines) ? d.routines.filter(r => r && SAFE_ID.test(r.id)).map(r => ({
    id: r.id, name: str(r.name, 40) || 'My Routine', items: (Array.isArray(r.items) ? r.items : []).filter(i => i && SAFE_ID.test(i.exId)).map(i => ({ exId: i.exId, sets: Math.round(num(i.sets, 1, 10) ?? 3) })),
  })) : b.routines;
  const body = (Array.isArray(d.body) ? d.body : []).filter(e => e && num(e.d, 1) && num(e.w, 1, 1000)).map(e => ({ d: e.d, w: e.w })).sort((a, b) => a.d - b.d);
  let active = null;
  const A = d.active;
  if (A && typeof A === 'object' && num(A.start, 1)) {
    const R = A.restT, H = A.hold;
    active = {
      id: SAFE_ID.test(A.id) ? A.id : uid(), name: str(A.name, 40) || 'Workout', start: A.start, rest: num(A.rest, 0, 864e2) || 0, notes: str(A.notes, 2000),
      routineId: SAFE_ID.test(A.routineId) ? A.routineId : null, exercises: cleanExs(A.exercises),
      restT: R && num(R.start, 1) && num(R.end, 1) && num(R.dur, 1) ? { start: R.start, end: R.end, dur: R.dur, fired: R.fired === true } : null,
      hold: H && num(H.ei) != null && num(H.si) != null && num(H.t0, 1) ? { ei: H.ei, si: H.si, t0: H.t0 } : null,
    };
    if (A.edit && typeof A.edit === 'object') { active.edit = { id: SAFE_ID.test(A.edit.id) ? A.edit.id : null }; active.dur = num(A.dur, 60, 864e2) || 3600; active.restT = null; active.hold = null; }
  }
  return { v: 1, settings: s, custom, routines, workouts, body, active };
}
const hydrate = d => sanitize(d && typeof d === 'object' ? d : {}); // PR flags are rebuilt at boot and after restore
let S = (() => { try { const raw = localStorage.getItem(KEY); if (raw) return hydrate(JSON.parse(raw)); } catch (e) { } return defaults(); })();
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 350); }
function saveNow() { clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save: storage full', 'alert'); } }
addEventListener('pagehide', saveNow);

let EXMAP = {};
function rebuildEx() { EXMAP = {}; for (const e of EXERCISES) EXMAP[e.id] = e; for (const e of S.custom) EXMAP[e.id] = e; }
const ex = id => EXMAP[id] || { id, name: 'Deleted exercise', muscle: 'Core', equip: '', type: 'w' };
const allEx = () => [...EXERCISES, ...S.custom].sort((a, b) => a.name.localeCompare(b.name));

/* ---------- formatting ---------- */
const unit = () => S.settings.unit;
const dunit = () => S.settings.dist;
const kgTo = kg => unit() === 'lb' ? kg * LB : kg;
const toKg = v => unit() === 'lb' ? v / LB : v;
const kmTo = km => dunit() === 'mi' ? km / MI : km;
const toKm = v => dunit() === 'mi' ? v * MI : v;
// Intl formatters are expensive to create, so build each one once and reuse it (big win on long History lists).
const FMTS = new Map();
const intl = (Kind, o) => { const k = Kind.name + JSON.stringify(o); let f = FMTS.get(k); if (!f) FMTS.set(k, f = new Kind(undefined, o)); return f; };
const NUM = intl(Intl.NumberFormat, {}), NUM1 = intl(Intl.NumberFormat, { maximumFractionDigits: 1 });
const fmtN = n => NUM1.format(r1(n));
const fmtW = kg => fmtN(kgTo(kg || 0));
const fmtD = km => NUM.format(r2(kmTo(km || 0)));
function fmtVol(kg) { const v = kgTo(kg || 0); return v >= 1e5 ? Math.round(v / 1000) + 'k' : v >= 1e4 ? r1(v / 1000) + 'k' : NUM.format(Math.round(v)); }
function fmtDur(sec) { sec = Math.round(sec || 0); if (!sec) return '0m'; if (sec < 60) return sec + 's'; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; }
function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`; }
const DATE_DEF = { weekday: 'short', month: 'short', day: 'numeric' };
const fmtDate = (ts, o = DATE_DEF) => intl(Intl.DateTimeFormat, o).format(ts);
const FMT = { int: n => NUM.format(Math.round(n)), vol: fmtVol, dur: fmtDur, n1: fmtN };

/* ---------- dates ---------- */
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }
function weekStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); }
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const keyToTs = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
function relDay(ts) { const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY); return diff === 0 ? 'today' : diff === 1 ? 'yesterday' : diff < 7 ? `${diff}d ago` : fmtDate(ts, { month: 'short', day: 'numeric' }); }
const pct = (a, b) => b ? Math.round((a - b) / b * 100) : 0;
const rangeTxt = ws => `${fmtDate(ws, { month: 'short', day: 'numeric' })} - ${fmtDate(addDays(ws, 6), { month: 'short', day: 'numeric' })}`;

/* ---------- icons ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  dots: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
  flame: '<path d="M12 22c4.4 0 7-3 7-7 0-4.5-3.5-6.5-4.5-11-2.5 1.8-4 4.4-4 7.2-1-.6-1.8-1.8-2-3.2C6.6 9.6 5 12 5 15c0 4 2.6 7 7 7z"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 10a5.5 5.5 0 0 1 8 0l-2.2 2.2a2.5 2.5 0 0 0-3.6 0z"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 21h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.3-9.4A5 5 0 0 1 12 6.5a5 5 0 0 1 9.3 4.1C19.5 15.4 12 20 12 20z"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  trendUp: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  trendDown: '<path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  plate: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  cardio: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
};
const I = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;

/* ---------- haptics & sound ---------- */
// iOS Safari has no Vibration API. Toggling a hidden <input switch> fires the system haptic on iOS 18+.
const Haptic = (() => {
  let label = null;
  function tick() {
    if (!S.settings.haptics) return;
    if (navigator.vibrate) { navigator.vibrate(12); return; }
    try {
      if (!label) {
        label = document.createElement('label'); label.ariaHidden = 'true'; label.style.display = 'none';
        const inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', '');
        label.appendChild(inp); document.head.appendChild(label);
      }
      label.click();
    } catch (e) { }
  }
  return {
    light: tick,
    medium: tick,
    success() { tick(); setTimeout(tick, 120); },
    heavy() { tick(); setTimeout(tick, 100); setTimeout(tick, 200); },
    error() { tick(); setTimeout(tick, 80); setTimeout(tick, 160); },
  };
})();

const Sound = (() => {
  let ctx;
  function unlock() { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { } }
  function beep(f, dur, when = 0, vol = .22) {
    if (!ctx || !S.settings.sound) return;
    const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + .03);
  }
  return {
    unlock,
    tick: () => beep(1046, .07, 0, .12),
    go: () => beep(1568, .22, 0, .2),
    done: () => { beep(660, .13); beep(880, .13, .15); beep(1320, .26, .3); },
    pr: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, .18, i * .09)),
  };
})();
document.addEventListener('touchstart', Sound.unlock, { passive: true });
document.addEventListener('click', Sound.unlock);

/* ---------- toast & confetti ---------- */
const TOAST_EMOJI = { sparkle: '✨', check: '✅', alert: '✋', trophy: '🏆', trash: '🗑️', bolt: '⚡', flame: '🔥', list: '📋', scale: '⚖️' };
// Optional action = { label, fn } adds a button (used for Undo and Reload).
function toast(msg, icon = 'check', action) {
  const t = document.createElement('div');
  t.className = 'toast' + (icon === 'trophy' ? ' pr' : '') + (action ? ' act' : '');
  t.innerHTML = `<span class="t-ic">${TOAST_EMOJI[icon] || icon}</span><span class="t-msg">${esc(msg)}</span>${action ? `<button class="t-btn">${esc(action.label)}</button>` : ''}`;
  const box = $('#toasts');
  while (box.children.length > 2) box.firstElementChild.remove();
  box.appendChild(t);
  const hide = () => { if (!t.isConnected) return; t.classList.remove('in'); setTimeout(() => t.remove(), 450); };
  if (action) $('.t-btn', t).addEventListener('click', e => { e.stopPropagation(); Haptic.light(); hide(); action.fn(); });
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('in')));
  setTimeout(hide, action ? 5000 : 2600);
}
const undoToast = (msg, fn) => toast(msg, 'trash', { label: 'Undo', fn });
function confetti(n = 120) {
  const c = $('#confetti'), x = c.getContext('2d'), dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  c.width = W * dpr; c.height = H * dpr; x.scale(dpr, dpr); c.style.display = 'block';
  const cols = [...PLATE_COLORS, '#C5EA47', '#1E3B32'];
  const P = Array.from({ length: n }, () => ({ x: W / 2 + (Math.random() - .5) * 120, y: H * .38, vx: (Math.random() - .5) * 15, vy: -Math.random() * 15 - 5, s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - .5) * .35, c: cols[Math.random() * cols.length | 0] }));
  const t0 = performance.now();
  (function f(t) {
    const k = (t - t0) / 1000; x.clearRect(0, 0, W, H);
    for (const p of P) {
      p.vy += .42; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.globalAlpha = Math.max(0, 1 - k / 2.4); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore();
    }
    if (k < 2.5) requestAnimationFrame(f); else { x.clearRect(0, 0, W, H); c.style.display = 'none'; }
  })(t0);
}

/* ---------- sheets ---------- */
const sheets = [];
function sheet(render, o = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet ${o.cls || ''}"><div class="grab"></div><div class="sheet-body"></div></div>`;
  const body = $('.sheet-body', wrap);
  body.innerHTML = render();
  sheets.push({ el: wrap, render, o });
  document.body.appendChild(wrap);
  $('.sheet-bg', wrap).addEventListener('click', () => closeSheet());
  dragDismiss($('.sheet', wrap), body);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  afterRender(body);
}
function refreshSheet() {
  const s = sheets[sheets.length - 1]; if (!s) return;
  const b = $('.sheet-body', s.el), top = b.scrollTop;
  b.innerHTML = s.render(); b.scrollTop = top;
}
function closeSheet() {
  const s = sheets.pop(); if (!s) return;
  s.el.classList.remove('open');
  setTimeout(() => s.el.remove(), 420);
  if (s.o.onClose) s.o.onClose();
}
function closeAllSheets() { while (sheets.length) closeSheet(); }
function dragDismiss(sh, body) {
  let y0 = null, dy = 0, drag = false, t0 = 0;
  sh.addEventListener('touchstart', e => {
    if (body.scrollTop > 0 && !e.target.closest('.grab')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; drag = false; t0 = Date.now();
  }, { passive: true });
  sh.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (!drag && dy > 10 && body.scrollTop <= 0) { drag = true; sh.style.transition = 'none'; }
    if (drag) sh.style.transform = `translateY(${Math.max(0, dy - 10)}px)`;
  }, { passive: true });
  sh.addEventListener('touchend', () => {
    if (!drag) return;
    drag = false; sh.style.transition = ''; sh.style.transform = '';
    if (dy > 130 || dy / (Date.now() - t0) > .7) { Haptic.light(); closeSheet(); }
  });
}
const sheetHead = (title, sub = '', right = '') => `<div class="sheet-head"><div><h2>${title}</h2>${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`;
let CONFIRM = null;
function confirmSheet(title, msg, ok, fn, danger) {
  CONFIRM = fn;
  sheet(() => `<div class="confirm"><h2>${title}</h2><p class="muted">${msg}</p><button class="${danger ? 'btn-danger' : 'btn-primary'}" data-a="confirmOk">${ok}</button><button class="btn-ghost" data-a="closeSheet">Cancel</button></div>`);
}

function afterRender(root) {
  $$('[data-count]', root).forEach(el => {
    const to = +el.dataset.count, f = FMT[el.dataset.fmt || 'int'], D = 900;
    if (!to) return;
    let t0 = null;
    const step = t => { if (t0 === null) t0 = t; const k = clamp((t - t0) / D, 0, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = f(to * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(() => { el.textContent = f(to); }, D + 200);
  });
}

/* ---------- stats ---------- */
const e1rm = (w, r) => (!w || !r) ? 0 : r === 1 ? w : w * (1 + r / 30);
const setScore = (x, s) => x.type === 'bw' ? ((s.w || 0) > 0 ? 1000 + e1rm(s.w, s.r) : (s.r || 0)) : e1rm(s.w, s.r);
// Finished workouts never change in place (edits replace the object), so their stats are cached.
const WS_CACHE = new WeakMap();
function wStats(w) {
  if (w.end && WS_CACHE.has(w)) return WS_CACHE.get(w);
  const s ={ dur: Math.max(0, ((w.end || Date.now()) - w.start) / 1000), vol: 0, sets: 0, reps: 0, rest: w.rest || 0, cardioSec: 0, dist: 0, muscles: {} };
  for (const e of w.exercises) {
    const x = ex(e.exId);
    for (const st of e.sets) {
      if (!st.done) continue;
      if (x.type === 'c') { s.cardioSec += st.sec || 0; s.dist += st.dist || 0; }
      if (st.t === 'w') continue;
      s.sets++; s.muscles[x.muscle] = (s.muscles[x.muscle] || 0) + 1;
      if (x.type === 'w' || x.type === 'bw') { s.reps += st.r || 0; s.vol += (st.w || 0) * (st.r || 0); }
    }
  }
  if (w.end && !('restT' in w)) WS_CACHE.set(w, s); // the live workout object always carries restT
  return s;
}
function weekAgg(ws) {
  const we = addDays(ws, 7), list = S.workouts.filter(w => w.start >= ws && w.start < we);
  const a = { ws, list, count: list.length, dur: 0, vol: 0, sets: 0, reps: 0, rest: 0, cardioSec: 0, dist: 0, muscles: {}, dayKeys: new Set(), dayMin: Array(7).fill(0), prList: [] };
  for (const w of list) {
    const st = wStats(w);
    a.dur += st.dur; a.vol += st.vol; a.sets += st.sets; a.reps += st.reps; a.rest += st.rest; a.cardioSec += st.cardioSec; a.dist += st.dist;
    for (const m in st.muscles) a.muscles[m] = (a.muscles[m] || 0) + st.muscles[m];
    a.dayKeys.add(dayKey(w.start));
    a.dayMin[(new Date(w.start).getDay() + 6) % 7] += st.dur / 60;
    for (const p of w.prs || []) a.prList.push(p);
  }
  a.prList.sort((x, y) => y.e1 - x.e1);
  a.prs = a.prList.length;
  return a;
}
function weekScore(a, b) {
  const g = S.settings.goal;
  let s = Math.min(a.count / g, 1) * 50;
  s += b.vol > 0 ? clamp(a.vol / b.vol, 0, 1.1) / 1.1 * 20 : (a.vol > 0 ? 20 : 0);
  s += Math.min(a.dayKeys.size / g, 1) * 15;
  s += Math.min(a.prs, 3) / 3 * 10;
  s += a.cardioSec > 0 ? 5 : 0;
  s = Math.round(s);
  const grade = !a.count ? '-' : s >= 90 ? 'A+' : s >= 80 ? 'A' : s >= 70 ? 'B+' : s >= 60 ? 'B' : s >= 45 ? 'C' : 'D';
  const label = !a.count ? 'Rest week' : s >= 90 ? 'Elite week' : s >= 80 ? 'Excellent week' : s >= 70 ? 'Strong week' : s >= 60 ? 'Solid work' : s >= 45 ? 'Building momentum' : 'Light week';
  return { s, grade, label };
}
const gradeCls = g => g[0] === 'A' ? 'a' : g[0] === 'B' ? 'b' : g === 'C' ? 'c' : 'd';
function weekStreak() {
  const g = S.settings.goal, per = new Map();
  for (const w of S.workouts) { const k = weekStart(w.start); per.set(k, (per.get(k) || 0) + 1); }
  const cnt = ws => per.get(ws) || 0;
  let ws = weekStart(Date.now()), n = cnt(ws) >= g ? 1 : 0;
  ws = addDays(ws, -7);
  while (n < 520 && cnt(ws) >= g) { n++; ws = addDays(ws, -7); }
  return n;
}
function lastSets(exId, before = Infinity) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    if (S.workouts[i].start >= before) continue;
    const e = S.workouts[i].exercises.find(e => e.exId === exId);
    if (e) return e.sets;
  }
  return null;
}
function bestScore(exId, before = Infinity) {
  const x = ex(exId); let b = 0;
  for (const w of S.workouts) {
    if (w.start >= before) continue;
    for (const e of w.exercises) if (e.exId === exId) for (const s of e.sets) if (s.t !== 'w') b = Math.max(b, setScore(x, s));
  }
  return b;
}
// Walks every workout in date order and rebuilds PR flags in one pass.
// Run after finishing, editing, deleting or restoring, so later workouts never keep stale records.
function recomputePRs() {
  S.workouts.sort((a, b) => a.start - b.start);
  const best = {};
  for (const w of S.workouts) {
    const prs = [], top = {};
    for (const e of w.exercises) {
      const x = ex(e.exId), lift = x.type === 'w' || x.type === 'bw';
      let bs = 0, bset = null;
      for (const s of e.sets) { s.pr = false; if (!lift || s.t === 'w') continue; const sc = setScore(x, s); if (sc > bs) { bs = sc; bset = s; } }
      if (!bset) continue;
      const hist = best[e.exId] || 0;
      if (hist > 0 && bs > hist) { bset.pr = true; prs.push({ exId: e.exId, w: bset.w || 0, r: bset.r || 0, e1: e1rm(bset.w, bset.r) || bset.r }); }
      top[e.exId] = Math.max(top[e.exId] || 0, bs);
    }
    for (const k in top) best[k] = Math.max(best[k] || 0, top[k]);
    w.prs = prs.sort((a, b) => b.e1 - a.e1);
  }
}
const prTxt = p => ex(p.exId).type === 'bw' && !p.w ? `${p.r} reps` : `${fmtW(p.w)} ${unit()} × ${p.r}`;
const extraTxt = (x, s, short) => {
  const v = x.extra && s[x.extra];
  if (!v) return '';
  return x.extra === 'inc' ? (short ? `${fmtN(v)}%` : `${fmtN(v)}% incline`) : (short ? `L${fmtN(v)}` : `level ${fmtN(v)}`);
};
const minTxt = sec => { const m = r1(sec / 60); return (m % 1 ? m : Math.round(m)) + ' min'; };
function setTxt(x, s, short) {
  if (x.type === 'c') {
    if (short) return [s.sec ? minTxt(s.sec).replace(' min', 'm') : '', s.dist ? fmtD(s.dist) : '', extraTxt(x, s, true)].filter(Boolean).join(' · ') || '-';
    return [s.sec ? minTxt(s.sec) : '', s.dist ? fmtD(s.dist) + ' ' + dunit() : '', extraTxt(x, s)].filter(Boolean).join(' · ') || '-';
  }
  if (x.type === 't') return s.sec ? fmtClock(s.sec) : '-';
  if (x.type === 'bw') return s.w ? `+${fmtW(s.w)}×${s.r || 0}` : `${s.r || 0} reps`;
  return `${fmtW(s.w)}×${s.r || 0}`;
}
// Body weight on or before a date (falls back to the first entry ever logged).
function bodyAt(ts) { let w = 0; for (const b of S.body) { if (b.d > ts && w) break; w = b.w; } return w; }
// Walking / running energy cost (ACSM equations, which account for incline). Needs time, distance and body weight.
const KCAL_EX = { run: 1, treadmill: 1, walk: 1 };
function cardioKcal(x, s, ts) {
  const kg = bodyAt(ts);
  if (!KCAL_EX[x.id] || !kg || !s.sec || !s.dist) return 0;
  const v = s.dist * 1000 / (s.sec / 60), g = (s.inc || 0) / 100;
  const vo2 = v < 134 ? 0.1 * v + 1.8 * v * g + 3.5 : 0.2 * v + 0.9 * v * g + 3.5;
  return vo2 * kg / 1000 * 5 * (s.sec / 60);
}
function cardioMeta(x, s, ts) {
  if (!s.sec || !s.dist) return '';
  const speed = kmTo(s.dist) / (s.sec / 3600), kc = cardioKcal(x, s, ts);
  return `${fmtN(speed)} ${dunit() === 'mi' ? 'mph' : 'km/h'} · ${fmtClock(s.sec / kmTo(s.dist))}/${dunit()}${kc ? ` · ≈${Math.round(kc)} kcal` : ''}`;
}
function setLabel(e, si) {
  const s = e.sets[si];
  if (s.t !== 'n') return s.t.toUpperCase();
  let n = 0; for (let j = 0; j <= si; j++) if (e.sets[j].t !== 'w') n++;
  return n;
}

/* ---------- charts ---------- */
let gidN = 0;
function smooth(P) {
  const f = n => n.toFixed(1);
  if (P.length < 3) return 'M' + P.map(p => f(p[0]) + ',' + f(p[1])).join(' L');
  let d = `M${f(P[0][0])},${f(P[0][1])}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2, t = .18;
    d += ` C${f(p1[0] + (p2[0] - p0[0]) * t)},${f(p1[1] + (p2[1] - p0[1]) * t)} ${f(p2[0] - (p3[0] - p1[0]) * t)},${f(p2[1] - (p3[1] - p1[1]) * t)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
function ring(p, size = 116, sw = 11, color = 'var(--lime)') {
  const r = (size - sw) / 2, c = size / 2; p = clamp(p || 0, 0, 1);
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="${r}" class="ring-bg" stroke-width="${sw}"/>
    <circle cx="${c}" cy="${c}" r="${r}" class="ring-fg ${p > 0 ? 'round' : ''}" style="stroke:${color}" stroke-width="${sw}" pathLength="100" stroke-dasharray="${(p * 100).toFixed(2)} 100" transform="rotate(-90 ${c} ${c})"/></svg>`;
}
// Signature illustration: one bumper plate per workout this week, ghost plates for the rest of the goal.
function barbellSVG(done, goal, cls = '') {
  const n = Math.min(7, Math.max(goal, done)), W = 2 + 11, plates = [];
  for (let i = 0; i < n; i++) {
    const h = 86 - i * 7, y = (60 - h / 2).toFixed(1), on = i < done, st = `--pc:${PLATE_COLORS[i % PLATE_COLORS.length]};animation-delay:${200 + i * 110}ms`;
    const p = x => `<rect class="bb-plate ${on ? 'on' : 'ghost'}" x="${x}" y="${y}" width="11" height="${h}" rx="3.5" style="${st}"/>`;
    plates.push(p(77 - i * W) + p(172 + i * W));
  }
  const id = 'bbs' + (++gidN);
  return `<svg class="bb ${cls}" viewBox="0 0 260 118" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--bar-a)"/><stop offset="1" style="stop-color:var(--bar-b)"/></linearGradient></defs>
    <ellipse class="bb-shadow" cx="130" cy="112" rx="104" ry="4"/>
    <g class="bb-lift">
      <rect x="2" y="56.5" width="256" height="7" rx="3.5" fill="url(#${id})"/>
      <path d="M104 57v6M110 57v6M116 57v6M144 57v6M150 57v6M156 57v6" stroke="rgba(0,0,0,.18)" stroke-width="1"/>
      <rect x="89" y="50" width="6" height="20" rx="2" fill="url(#${id})"/><rect x="165" y="50" width="6" height="20" rx="2" fill="url(#${id})"/>
      ${plates.join('')}
    </g></svg>`;
}
function lineChart(pts, o = {}) {
  if (!pts.length) return `<div class="chart-empty">${o.empty || 'Not enough data yet'}</div>`;
  if (pts.length === 1) pts = [{ x: pts[0].x - DAY, y: pts[0].y }, pts[0]];
  const W = 340, H = o.h || 170, T = 22, B = 22, f = o.fmt || fmtN;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), all = ys.concat((o.avg || []).map(p => p.y));
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...all), y1 = Math.max(...all);
  if (x1 === x0) x1 = x0 + 1;
  const py = (y1 - y0) * .18 || Math.max(1, Math.abs(y1) * .05); y0 -= py; y1 += py;
  const X = x => 6 + (x - x0) / (x1 - x0) * (W - 12), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const id = 'lc' + (++gidN), P = pts.map(p => [X(p.x), Y(p.y)]), line = smooth(P), lp = P[P.length - 1];
  const area = `${line} L${lp[0].toFixed(1)},${H - B} L${P[0][0].toFixed(1)},${H - B} Z`;
  const grid = [0, .5, 1].map(k => { const y = (T + k * (H - T - B)).toFixed(1); return `<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`; }).join('');
  const avg = o.avg && o.avg.length > 1 ? `<path class="avg" d="${smooth(o.avg.map(p => [X(p.x), Y(p.y)]))}"/>` : '';
  const dfmt = ts => fmtDate(ts, { month: 'short', day: 'numeric' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--chart);stop-opacity:.22"/><stop offset="1" style="stop-color:var(--chart);stop-opacity:0"/></linearGradient>
    <linearGradient id="${id}s" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0"><stop offset="0" style="stop-color:var(--chart2)"/><stop offset="1" style="stop-color:var(--chart)"/></linearGradient></defs>
    ${grid}<path class="area" d="${area}" fill="url(#${id}a)"/>${avg}<path class="line" d="${line}" pathLength="1" stroke="url(#${id}s)"/>
    <circle class="dot" cx="${lp[0].toFixed(1)}" cy="${lp[1].toFixed(1)}" r="4.5"/>
    <text x="0" y="${T - 8}">${f(Math.max(...ys))}</text><text x="${W}" y="${T - 8}" text-anchor="end" class="hi">Now ${f(pts[pts.length - 1].y)}</text>
    <text x="0" y="${H - 6}">${dfmt(x0)}</text><text x="${W}" y="${H - 6}" text-anchor="end">${dfmt(x1)}</text></svg>`;
}
function barChart(items, o = {}) {
  const W = 340, H = o.h || 150, T = 18, B = 20, n = items.length, gap = 8, bw = (W - gap * (n - 1)) / n;
  const max = Math.max(1, ...items.map(i => i.v)), f = o.fmt || fmtN;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
  ${items.map((it, i) => {
    const h = Math.max(it.v ? 4 : 2, it.v / max * (H - T - B)), x = i * (bw + gap), y = H - B - h, cx = (x + bw / 2).toFixed(1);
    const lbl = it.v && (it.hi || it.v === max) ? `<text x="${cx}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="${it.hi ? 'hi' : ''}">${f(it.v)}</text>` : '';
    return `<rect class="bar ${it.hi ? 'hi' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(8, bw / 3).toFixed(1)}" style="animation-delay:${i * 45}ms"/>${lbl}<text x="${cx}" y="${H - 5}" text-anchor="middle">${it.label}</text>`;
  }).join('')}</svg>`;
}
function heatmap(weeks = 18) {
  const start = addDays(weekStart(Date.now()), -(weeks - 1) * 7), mins = {}, today = dayKey(Date.now());
  for (const w of S.workouts) if (w.start >= start) { const k = dayKey(w.start); mins[k] = (mins[k] || 0) + ((w.end || w.start) - w.start) / 60000; }
  let html = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), k = dayKey(d), m = mins[k] || 0;
    const lv = d > Date.now() ? 'fut' : !m ? '' : m < 30 ? 'l1' : m < 60 ? 'l2' : m < 90 ? 'l3' : 'l4';
    html += `<i class="hc ${lv} ${k === today ? 'today' : ''}"></i>`;
  }
  return `<div class="heat">${html}</div>`;
}
const heatLegend = () => `<div class="legend heat-lg"><span>Less</span>${['', 'l1', 'l2', 'l3', 'l4'].map(l => `<i class="hc ${l}"></i>`).join('')}<span>More</span><span class="muted">30 · 60 · 90 min</span></div>`;
function muscleBars(cur, prev) {
  const keys = Object.keys(MUSCLES).filter(m => cur[m] || (prev && prev[m]));
  if (!keys.length) return '<p class="muted sm">No sets logged.</p>';
  const mx = Math.max(1, ...keys.map(m => Math.max(cur[m] || 0, prev ? prev[m] || 0 : 0)));
  return keys.map((m, i) => `<div class="mrow" style="--mc:${MUSCLES[m]}"><span>${m}</span><div class="mtrack"><div class="mfill" style="width:${(cur[m] || 0) / mx * 100}%;animation-delay:${i * 60}ms"></div>${prev ? `<div class="mprev" style="left:calc(${(prev[m] || 0) / mx * 100}% - 1px)"></div>` : ''}</div><b>${cur[m] || 0}</b></div>`).join('');
}

/* ---------- small components ---------- */
function delta(a, b, mode) {
  if (!a && !b) return '<span class="delta">-</span>';
  if (!b) return '<span class="delta up">new</span>';
  const p = pct(a, b), cls = mode === 'neutral' || p === 0 ? '' : p > 0 ? 'up' : 'down';
  return `<span class="delta ${cls}">${p > 0 ? '↑' : p < 0 ? '↓' : ''}${Math.abs(p)}%</span>`;
}
const tile = (l, v, f = '') => `<div class="tile"><small>${l}</small><b>${v}</b>${f ? `<div class="tile-f">${f}</div>` : ''}</div>`;
const tileC = (l, raw, fmt, suffix = '') => `<div class="tile"><small>${l}</small><b><span data-count="${raw}" data-fmt="${fmt}">${FMT[fmt](raw)}</span>${suffix}</b></div>`;
const EMPTY_EMOJI = { clock: '🗓️', chart: '📈', scale: '⚖️', dumbbell: '🏋️', list: '📋' };
const emptyState = (icon, title, text, btn = '') => `<div class="empty"><span class="big-emoji">${EMPTY_EMOJI[icon] || icon}</span><b>${title}</b><p>${text}</p>${btn}</div>`;
const etile = (m, cls = '') => `<span class="etile ${cls}" style="--mc:${MUSCLES[m] || '#999'}">${MEMOJI[m] || '•'}</span>`;
const row = (icon, label, val, action, attrs = '', cls = '') => `<div class="row ${cls}" data-a="${action}" ${attrs}><span class="row-ic">${ICONS[icon] ? I(icon) : icon}</span><span class="row-l">${label}</span>${val !== '' ? `<span class="row-v">${val}</span>` : ''}${I('right')}</div>`;
const muscleDots = items => [...new Set(items.map(id => ex(id).muscle))].map(m => `<i style="--mc:${MUSCLES[m]}"></i>`).join('');
function lastDone(r) {
  for (let i = S.workouts.length - 1; i >= 0; i--) if (S.workouts[i].routineId === r.id || S.workouts[i].name === r.name) return S.workouts[i].start;
  return 0;
}

/* ---------- views ---------- */
let tab = 'home', progTab = 'overview', RV = 0, EI = null, WD = null, RE = null, CX = null, BWV = null, PC = null, OR = { w: '', r: '' };
let PK = { q: '', m: 'All', sel: [], cb: null, mode: 'multi' };

function installCard() {
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (standalone || S.settings.hideInstall) return '';
  return `<div class="install"><span>📲</span><div><b>Put Forge on your Home Screen</b><small>In Safari tap Share, then Add to Home Screen. It opens like a real app and keeps your data safe.</small></div><button class="icon-btn sm" data-a="hideInstall" aria-label="Dismiss">${I('x')}</button></div>`;
}
// Data only lives on this phone, so nudge a backup every two weeks once there is something worth saving.
function backupCard() {
  const s = S.settings, last = Math.max(s.lastBackup || 0, s.backupSnooze || 0);
  if (S.workouts.length < 3 || Date.now() - last < 14 * DAY) return '';
  return `<div class="install backup"><span>💾</span><div><b>Back up your workouts</b><small>${s.lastBackup ? `Last backup ${relDay(s.lastBackup)}.` : 'No backup yet.'} Save a copy to iCloud Drive in one tap.</small><button class="link" data-a="exportJson">Back up now</button></div><button class="icon-btn sm" data-a="snoozeBackup" aria-label="Remind me later">${I('x')}</button></div>`;
}
function routineMuscle(r) {
  const c = {};
  r.items.forEach(it => { const m = ex(it.exId).muscle; c[m] = (c[m] || 0) + it.sets; });
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'Legs';
}
const heroMsg = (c, g) => !c ? 'Empty bar. Load your first plate this week.' : c < g ? `${g - c} more workout${g - c > 1 ? 's' : ''} to fully load the bar.` : c === g ? 'Fully loaded. Weekly goal done 💪' : 'Over-achiever. Bonus plates earned.';

function vHome() {
  const now = Date.now(), ws = weekStart(now), a = weekAgg(ws), b = weekAgg(addDays(ws, -7)), g = S.settings.goal;
  const lastWs = addDays(ws, -7), lastScore = weekScore(b, weekAgg(addDays(ws, -14)));
  const h = new Date().getHours();
  const greet = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const streak = weekStreak(), vp = pct(a.vol, b.vol);
  const dots = [...Array(7)].map((_, i) => { const k = dayKey(addDays(ws, i)), on = a.dayKeys.has(k); return `<div class="dd ${on ? 'on' : ''} ${k === dayKey(now) ? 'today' : ''}"><i style="animation-delay:${400 + i * 60}ms">${on ? '✓' : ''}</i><span>${'MTWTFSS'[i]}</span></div>`; }).join('');
  const recent = S.workouts.slice(-4).reverse();
  const bw = S.body[S.body.length - 1];
  return `
  <header class="top"><div><p class="eyebrow">${fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>${greet}${S.settings.name ? ', ' + esc(S.settings.name) : ''}</h1></div>
    ${streak ? `<span class="streak" title="Weeks in a row you hit your goal">🔥 ${streak}<small>wk</small></span>` : ''}</header>
  ${installCard()}${backupCard()}
  ${S.active ? `<button class="resume" data-a="woOpen"><span class="pulse"></span><div><small>${S.active.edit ? 'Editing workout' : 'Workout in progress'}</small><b>${esc(S.active.name)}</b></div><span class="mono" data-clock></span><span class="chev">›</span></button>` : ''}
  <section class="hero" data-a="lift">
    <div class="hero-top"><div><p class="hero-label">This week</p><p class="hero-num"><span data-count="${a.count}">${a.count}</span><small> / ${g} workouts</small></p></div>
      ${b.vol ? `<span class="pill ${vp >= 0 ? 'up' : 'down'}">${vp >= 0 ? '▲' : '▼'} ${Math.abs(vp)}% volume</span>` : ''}</div>
    ${barbellSVG(a.count, g)}
    <p class="hero-msg">${heroMsg(a.count, g)}</p>
    <div class="days">${dots}</div>
    <div class="hero-split"><div><span>Volume</span><b>${fmtVol(a.vol)}<i>${unit()}</i></b></div><div><span>Time</span><b>${fmtDur(a.dur)}</b></div><div><span>Sets</span><b>${a.sets}</b></div></div>
  </section>
  <section class="card review-cta" data-a="review" data-ws="${lastWs}">
    <div class="grade">${lastScore.grade}</div>
    <div class="rc-main"><b>Weekly review</b><small>Last week: ${lastScore.label} · ${b.count} workout${b.count === 1 ? '' : 's'}</small><span class="rc-sub" data-a="review" data-ws="${ws}">This week so far ›</span></div>
    <span class="chev">›</span>
  </section>
  <section>
    <div class="sec-h"><h2>Start training</h2><button class="link" data-a="newRoutine">+ Routine</button></div>
    <div class="hscroll">${S.routines.map(r => {
      const ld = lastDone(r), m = routineMuscle(r);
      return `<div class="r-card" style="--c:${MUSCLES[m]}" data-a="startRoutine" data-id="${r.id}"><div class="rc-top"><span class="rc-emoji">${MEMOJI[m]}</span><button class="icon-btn" data-a="editRoutine" data-id="${r.id}" aria-label="Edit routine">${I('dots')}</button></div><b>${esc(r.name)}</b><small>${r.items.length} exercises · ${ld ? relDay(ld) : 'new'}</small></div>`;
    }).join('')}<div class="r-card add" data-a="newRoutine"><span>+</span>New routine</div></div>
    <button class="btn-primary big" data-a="startEmpty">${I('play')} Start empty workout</button>
  </section>
  <section>
    <div class="sec-h"><h2>Recent</h2>${recent.length ? '<button class="link" data-a="tab" data-tab="history">See all</button>' : ''}</div>
    ${recent.length ? `<div class="list">${recent.map(wCard).join('')}</div>` : emptyState('🪶', 'Nothing logged yet', 'Tap the lime + below or pick a routine above to start your first session.')}
  </section>
  <section>
    <div class="sec-h"><h2>Body weight</h2><button class="link" data-a="logBody">+ Log</button></div>
    <div class="card" data-a="tab" data-tab="progress" data-prog="body">${bw ? `<div class="big-num" style="font-size:36px">${fmtW(bw.w)}<i>${unit()} · ${relDay(bw.d)}</i></div>${lineChart(S.body.slice(-20).map(e => ({ x: e.d, y: kgTo(e.w) })), { h: 110 })}` : `<p class="muted">⚖️ Log your weight a few times a week and Forge draws the trend.</p>`}</div>
  </section>`;
}

function wCard(w) {
  const st = wStats(w), d = new Date(w.start), total = Object.values(st.muscles).reduce((a, b) => a + b, 0) || 1;
  const seg = Object.entries(st.muscles).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<i style="--mc:${MUSCLES[m]};flex:${n / total}"></i>`).join('');
  const meta = [fmtDur(st.dur), st.vol ? `${fmtVol(st.vol)} ${unit()}` : '', st.dist ? `${fmtD(st.dist)} ${dunit()}` : '', `${st.sets} set${st.sets === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return `<div class="w-card" data-a="wDetail" data-id="${w.id}"><div class="w-date"><b>${d.getDate()}</b><small>${fmtDate(w.start, { weekday: 'short' })}</small></div>
    <div class="w-main"><b>${esc(w.name)}</b><div class="w-meta">${meta}</div><div class="mbar">${seg}</div></div>
    ${(w.prs || []).length ? `<span class="pr-pill">🏆 ${w.prs.length}</span>` : '<span class="chev">›</span>'}</div>`;
}

let histN = 60;
function vHistory() {
  const all = S.workouts.slice().reverse(), list = all.slice(0, histN);
  const head = `<header class="top"><div><p class="eyebrow">${all.length} workout${all.length === 1 ? '' : 's'} logged</p><h1>History</h1></div><button class="chip-btn" data-a="logPast">${I('history')} Log past</button></header>`;
  if (!list.length) return head + emptyState('clock', 'No workouts yet', 'Every workout you finish lands here with full details.', `<button class="btn-primary" data-a="startMenu">${I('play')} Start a workout</button>`);
  const groups = [];
  for (const w of list) {
    const m = fmtDate(w.start, { month: 'long', year: 'numeric' });
    if (!groups.length || groups[groups.length - 1].m !== m) groups.push({ m, ws: [] });
    groups[groups.length - 1].ws.push(w);
  }
  return head + `<section class="card"><div class="card-h"><b>Last 18 weeks</b><span class="muted sm">${S.workouts.filter(w => w.start >= addDays(Date.now(), -126)).length} sessions</span></div>${heatmap()}${heatLegend()}</section>`
    + groups.map(g => `<section class="cv"><p class="month"><span>${g.m}</span><span>${g.ws.length} workout${g.ws.length === 1 ? '' : 's'}</span></p><div class="list">${g.ws.map(wCard).join('')}</div></section>`).join('')
    + (all.length > list.length ? `<button class="btn-ghost" data-a="histMore">Show older workouts (${all.length - list.length})</button>` : '');
}

function segCtl(key, opts, cur) {
  const i = opts.findIndex(o => o[0] === cur);
  return `<div class="seg" id="seg-${key}" style="--n:${opts.length};--i:${i}"><span class="seg-ind"></span>${opts.map(([k, l]) => `<button data-a="seg" data-k="${key}" data-v="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function vProgress() {
  return `<header class="top"><div><p class="eyebrow">Your numbers</p><h1>Progress</h1></div></header>
  ${segCtl('prog', [['overview', 'Overview'], ['body', 'Body'], ['lifts', 'Exercises']], progTab)}
  <div id="progBody">${progBody()}</div>`;
}
const progBody = () => progTab === 'body' ? vBody() : progTab === 'lifts' ? vLifts() : vOverview();

function vOverview() {
  const W = S.workouts;
  if (!W.length) return emptyState('chart', 'No data yet', 'Finish your first workout and your trends, heatmap and weekly reviews show up here.');
  let dur = 0, vol = 0, prs = 0;
  for (const w of W) { const s = wStats(w); dur += s.dur; vol += s.vol; prs += (w.prs || []).length; }
  const cws = weekStart(Date.now());
  const weeks = Array.from({ length: 10 }, (_, i) => { const s = addDays(cws, -(9 - i) * 7); return { s, a: weekAgg(s) }; });
  const m30 = {}, since = Date.now() - 30 * DAY;
  for (const w of W) if (w.start >= since) { const s = wStats(w); for (const m in s.muscles) m30[m] = (m30[m] || 0) + s.muscles[m]; }
  const revs = weeks.slice(-6).reverse().map(({ s, a }) => {
    const sc = weekScore(a, weekAgg(addDays(s, -7)));
    return `<div class="row" data-a="review" data-ws="${s}"><span class="grade-sm g-${gradeCls(sc.grade)}">${sc.grade}</span><span class="row-l">${s === cws ? 'This week' : rangeTxt(s)}<small>${a.count} workouts · ${fmtVol(a.vol)} ${unit()} · ${fmtDur(a.dur)}</small></span>${I('right')}</div>`;
  }).join('');
  return `<div class="fade-in">
  <div class="tiles">${tileC('Workouts', W.length, 'int')}${tileC('Time trained', dur, 'dur')}${tileC('Total volume', vol, 'vol', ` <i class="muted sm">${unit()}</i>`)}${tileC('Personal records', prs, 'int')}</div>
  <div class="card"><div class="card-h"><b>Weekly volume</b><span class="muted sm">${unit()}</span></div>${barChart(weeks.map(({ s, a }, i) => ({ label: fmtDate(s, { month: 'numeric', day: 'numeric' }), v: kgTo(a.vol), hi: i === 9 })), { fmt: v => fmtVol(toKg(v)) })}</div>
  <section><div class="sec-h"><h2>Weekly reviews</h2></div><div class="list">${revs}</div></section>
  <div class="card"><div class="card-h"><b>Consistency</b><span class="muted sm">last 18 weeks</span></div>${heatmap()}${heatLegend()}</div>
  <div class="card"><div class="card-h"><b>Muscle split</b><span class="muted sm">sets, last 30 days</span></div>${muscleBars(m30)}</div>
  </div>`;
}

function vBody() {
  const B = S.body, btn = `<button class="btn-primary" data-a="logBody">${I('plus')} Log body weight</button>`;
  if (!B.length) return `<div class="fade-in">${emptyState('scale', 'Track your body weight', 'Log your weight a few times a week. Forge smooths the daily noise into a clear trend line.')}${btn}</div>`;
  const last = B[B.length - 1], first = B[0], since30 = B.find(e => e.d >= Date.now() - 30 * DAY);
  const chg = (d, l) => `<div><b>${d > 0 ? '+' : ''}${fmtW(d)} ${unit()}</b><small>${l}</small></div>`;
  const src = B.filter(e => e.d >= Date.now() - 180 * DAY), use = src.length > 1 ? src : B.slice(-30);
  const pts = use.map(e => ({ x: e.d, y: kgTo(e.w) }));
  const avg = pts.map((p, i) => { const s = pts.slice(Math.max(0, i - 6), i + 1); return { x: p.x, y: s.reduce((a, b) => a + b.y, 0) / s.length }; });
  return `<div class="fade-in">
  <div class="card"><small class="muted">Current</small><div class="big-num"><span data-count="${kgTo(last.w)}" data-fmt="n1">${fmtW(last.w)}</span><i>${unit()}</i></div>
    <div class="bw-ch">${since30 && since30 !== last ? chg(last.w - since30.w, 'last 30 days') : ''}${B.length > 1 ? chg(last.w - first.w, 'since start') : ''}</div>
    ${lineChart(pts, { avg })}<div class="legend"><span><i class="lg-line"></i>Weigh-ins</span><span><i class="lg-avg"></i>7-entry average</span></div></div>
  ${btn}
  <div class="sec-h"><h2>Entries</h2></div>
  <div class="list">${B.slice().reverse().slice(0, 40).map((e, i) => {
    const idx = B.length - 1 - i, prev = B[idx - 1], d = prev ? e.w - prev.w : 0;
    return `<div class="row"><span class="row-l">${fmtDate(e.d, { weekday: 'short', month: 'short', day: 'numeric' })}${prev ? `<small>${d > 0 ? '+' : ''}${fmtW(d)} ${unit()}</small>` : ''}</span><b class="mono">${fmtW(e.w)} ${unit()}</b><button class="icon-btn sm" data-a="delBody" data-i="${idx}" aria-label="Delete entry">${I('trash')}</button></div>`;
  }).join('')}</div></div>`;
}

function vLifts() {
  const map = {};
  for (const w of S.workouts) for (const e of w.exercises) {
    const x = ex(e.exId), m = map[e.exId] || (map[e.exId] = { x, n: 0, last: 0, best: 0 });
    m.n++; m.last = Math.max(m.last, w.start);
    for (const s of e.sets) if (s.t !== 'w') m.best = Math.max(m.best, x.type === 'w' ? e1rm(s.w, s.r) : x.type === 'bw' ? (s.r || 0) : x.type === 'c' ? (s.dist || 0) : (s.sec || 0));
  }
  const list = Object.values(map).sort((a, b) => b.last - a.last);
  if (!list.length) return `<div class="fade-in">${emptyState('dumbbell', 'No exercises logged', 'Your lifts, estimated 1RMs and rep records appear here once you train.')}</div>`;
  const best = m => m.x.type === 'w' ? `${fmtW(m.best)} ${unit()}<small> e1RM</small>` : m.x.type === 'bw' ? `${m.best} reps` : m.x.type === 'c' ? `${fmtD(m.best)} ${dunit()}` : fmtClock(m.best);
  return `<div class="fade-in"><div class="list">${list.map(m => `<div class="row" data-a="exInfo" data-id="${m.x.id}" >${etile(m.x.muscle, 'sm')}<span class="row-l">${esc(m.x.name)}<small>${m.n} session${m.n === 1 ? '' : 's'} · ${relDay(m.last)}</small></span><span class="row-v">${best(m)}</span>${I('right')}</div>`).join('')}</div></div>`;
}

function vMore() {
  const s = S.settings, init = (s.name || 'F').trim()[0].toUpperCase();
  const first = S.workouts[0];
  const tg = (k, l) => `<button class="tgl ${s[k] ? 'on' : ''}" data-a="toggle" data-k="${k}" role="switch" aria-checked="${!!s[k]}" aria-label="${l}"></button>`;
  const ms = (k, opts) => `<div class="mseg">${opts.map(v => `<button class="${s[k] === v ? 'on' : ''}" data-a="setOpt" data-k="${k}" data-v="${v}">${v}</button>`).join('')}</div>`;
  const stp = (k, v) => { const l = k === 'rest' ? 'default rest' : 'weekly goal'; return `<div class="stp"><button data-a="step" data-k="${k}" data-d="-1" aria-label="Decrease ${l}">${I('minus')}</button><span id="stp-${k}" aria-live="polite">${v}</span><button data-a="step" data-k="${k}" data-d="1" aria-label="Increase ${l}">${I('plus')}</button></div>`; };
  const line = (icon, label, ctl) => `<div class="row"><span class="row-ic">${icon}</span><span class="row-l">${label}</span>${ctl}</div>`;
  return `<header class="top"><div><p class="eyebrow">Profile & settings</p><h1>More</h1></div></header>
  <section class="card profile"><div class="avatar">${esc(init)}</div><div style="flex:1;min-width:0"><input data-f="name" aria-label="Your name" value="${esc(s.name)}" placeholder="Your name" maxlength="24"><small>${S.workouts.length} workouts${first ? ' since ' + fmtDate(first.start, { month: 'short', year: 'numeric' }) : ''}</small></div></section>
  <section><p class="group-label">Library</p></section>
  <div class="list">${row('📋', 'Routines', S.routines.length, 'routines')}${row('🏋️', 'Exercises', allEx().length, 'library')}</div>
  <section><p class="group-label">Tools</p></section>
  <div class="list">${row('🧮', 'Plate calculator', '', 'plates')}${row('📐', '1RM calculator', '', 'orm')}${row('📝', 'Weekly review', '', 'review', `data-ws="${weekStart(Date.now())}"`)}</div>
  <section><p class="group-label">Preferences</p></section>
  <div class="list">
    ${line('🌗', 'Appearance', ms('theme', ['auto', 'light', 'dark']))}
    ${line('⚖️', 'Weight unit', ms('unit', ['kg', 'lb']))}
    ${line('📏', 'Distance unit', ms('dist', ['km', 'mi']))}
    ${line('⏱️', 'Default rest', stp('rest', restLbl(s.rest)))}
    ${line('🎯', 'Weekly goal', stp('goal', s.goal + ' / wk'))}
    ${line('🔁', 'Auto-start rest timer', tg('autoRest', 'Auto-start rest timer'))}
    ${line('📳', 'Haptics', tg('haptics', 'Haptics'))}
    ${line('🔔', 'Sounds', tg('sound', 'Sounds'))}
    ${line('☀️', 'Keep screen awake', tg('wake', 'Keep screen awake'))}
  </div>
  <section><p class="group-label">Your data</p></section>
  <div class="list">${row('💾', `Export backup<small>${s.lastBackup ? 'Last backup ' + relDay(s.lastBackup) : 'Never backed up'}</small>`, 'JSON', 'exportJson')}${row('📊', 'Export spreadsheet', 'CSV', 'exportCsv')}${row('📥', 'Restore backup', '', 'importJson')}${row('🗑️', '<span class="danger">Erase all data</span>', '', 'reset')}</div>
  <p class="foot">Everything stays on this phone. No account, no cloud, no cost.</p>`;
}

const restLbl = s => s ? fmtClock(s) : 'Off';
const VIEWS = { home: vHome, history: vHistory, progress: vProgress, more: vMore };
function render(anim) {
  const v = $('#view');
  v.innerHTML = VIEWS[tab]();
  if (anim) { v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
  $$('#tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.body.classList.toggle('has-active', !!S.active);
  updateMini();
  if (anim) afterRender(v);
}

/* ---------- review ---------- */
const INS_EMOJI = { moon: '😴', trophy: '🏆', bolt: '⚡', trendUp: '📈', trendDown: '📉', check: '👌', alert: '⚖️', dumbbell: '💪', timer: '⏱️', heart: '❤️', scale: '🪶' };
function insights(a, b, live) {
  const g = S.settings.goal, out = [];
  if (!a.count) return [['moon', live ? 'No sessions logged yet this week. Plenty of time to get one in.' : 'No workouts this week. Recovery matters, so treat it as a reset and get back to it.']];
  if (a.count >= g) out.push(['trophy', `Goal hit: ${a.count} of ${g} sessions.`]);
  else out.push(['bolt', `${a.count} of ${g} sessions. ${g - a.count} more ${live ? 'to hit' : 'would have hit'} your goal.`]);
  if (b.vol > 0 && a.vol > 0) {
    const p = pct(a.vol, b.vol);
    if (p >= 5) out.push(['trendUp', `Volume up ${p}% on last week. That is progressive overload doing its job.`]);
    else if (p <= -10 && !live) out.push(['trendDown', `Volume down ${-p}% on last week. Fine for a deload, otherwise add a set or two per exercise.`]);
    else if (!live) out.push(['check', 'Volume held steady compared with last week.']);
  }
  if (a.prs) out.push(['trophy', `${a.prs} personal record${a.prs > 1 ? 's' : ''}, led by ${esc(ex(a.prList[0].exId).name)} at ${prTxt(a.prList[0])}.`]);
  const miss = ['Chest', 'Back', 'Legs', 'Shoulders'].filter(m => !a.muscles[m]);
  if (a.sets >= 8 && miss.length && miss.length < 4) out.push(['alert', `No direct ${miss.join(', ')} work. Worth balancing ${live ? 'before Sunday' : 'next week'}.`]);
  const push = (a.muscles.Chest || 0) + (a.muscles.Shoulders || 0), pull = a.muscles.Back || 0;
  if (push >= 6 && pull > 0 && push / pull > 1.6) out.push(['alert', `Push sets outnumber pull ${push} to ${pull}. Add rows or pull-ups to keep shoulders healthy.`]);
  const top = Object.entries(a.muscles).filter(([m]) => m !== 'Cardio').sort((x, y) => y[1] - x[1])[0];
  if (top) out.push(['dumbbell', `Most trained: ${top[0]} with ${top[1]} working sets.`]);
  if (a.sets && a.rest) out.push(['timer', `You rested ${fmtDur(a.rest)} in total, about ${fmtClock(a.rest / a.sets)} per set.`]);
  const cm = Math.round(a.cardioSec / 60);
  if (cm || b.cardioSec) out.push(['heart', `${cm} cardio minutes${a.dist ? ` covering ${fmtD(a.dist)} ${dunit()}` : ''}. Health guidelines suggest 150 a week.`]);
  const inWk = S.body.filter(x => x.d >= a.ws && x.d < addDays(a.ws, 7)), pre = S.body.filter(x => x.d < a.ws).pop();
  if (inWk.length && pre) { const d = inWk[inWk.length - 1].w - pre.w; out.push(['scale', `Body weight ${d >= 0 ? '+' : ''}${fmtW(d)} ${unit()} over the week.`]); }
  return out;
}
function vReview() {
  const cur = weekStart(Date.now()), ws = RV, a = weekAgg(ws), b = weekAgg(addDays(ws, -7)), sc = weekScore(a, b), live = ws === cur;
  const tiles = [
    ['Workouts', a.count, b.count, a.count, b.count],
    ['Time', a.dur, b.dur, fmtDur(a.dur), fmtDur(b.dur)],
    ['Volume', a.vol, b.vol, `${fmtVol(a.vol)} <i class="muted sm">${unit()}</i>`, fmtVol(b.vol)],
    ['Sets', a.sets, b.sets, a.sets, b.sets],
    ['Cardio', a.cardioSec, b.cardioSec, fmtDur(a.cardioSec), fmtDur(b.cardioSec)],
    ['Rest', a.rest, b.rest, fmtDur(a.rest), fmtDur(b.rest), 'neutral'],
  ].map(([l, x, y, fx, fy, m]) => tile(l, fx, `${delta(x, y, m)}<span>last wk ${fy}</span>`)).join('');
  const mx = Math.max(1, ...a.dayMin, ...b.dayMin);
  const days = a.dayMin.map((m, i) => `<div class="dc"><div class="dc-bars"><i class="pv" style="height:${b.dayMin[i] / mx * 100}%"></i><i class="cu" style="height:${m / mx * 100}%;animation-delay:${i * 50}ms"></i></div><span>${'MTWTFSS'[i]}</span></div>`).join('');
  const prs = a.prList.slice(0, 6).map(p => `<div class="pr-row"><span>🏆</span><b>${esc(ex(p.exId).name)}</b><span>${prTxt(p)}</span></div>`).join('');
  return `<div class="rv-nav"><button class="icon-btn sm" data-a="revNav" data-d="-1" aria-label="Previous week">${I('left')}</button><div><h2>Weekly Review</h2><small class="muted">${rangeTxt(ws)}${live ? ' · in progress' : ''}</small></div><button class="icon-btn sm" data-a="revNav" data-d="1" aria-label="Next week" ${live ? 'disabled' : ''}>${I('right')}</button></div>
  <div class="card score"><div class="hero-ring" style="width:108px;height:108px">${ring(sc.s / 100, 108, 10)}<div class="ring-c"><b>${sc.grade}</b><small>${sc.s}/100</small></div></div>
    <div><small class="muted">${live ? 'So far' : 'Verdict'}</small><h3>${sc.label}</h3><p class="muted sm">${a.count}/${S.settings.goal} workouts · ${a.dayKeys.size} active days · ${a.prs} PR${a.prs === 1 ? '' : 's'}</p></div></div>
  <div class="tiles">${tiles}</div>
  <div class="card"><div class="card-h"><b>Training minutes</b><div class="legend" style="margin:0"><span><i class="lg-cur"></i>This</span><span><i class="lg-prev"></i>Last</span></div></div><div class="dchart">${days}</div></div>
  <div class="card"><div class="card-h"><b>Sets per muscle</b><span class="muted sm">line = last week</span></div>${muscleBars(a.muscles, b.muscles)}</div>
  ${prs ? `<div class="card"><div class="card-h"><b>Personal records</b></div>${prs}</div>` : ''}
  <div class="card"><div class="card-h"><b>Coach notes</b><span>✍️</span></div>${insights(a, b, live).map(([ic, t]) => `<div class="ins"><span class="ins-ic">${INS_EMOJI[ic] || '💡'}</span><p>${t}</p></div>`).join('')}</div>`;
}

/* ---------- workout engine ---------- */
const newSet = (t = 'n') => ({ t, w: null, r: null, sec: null, dist: null, done: false });
function newWE(exId, n) {
  const prev = lastSets(exId);
  const k = n || (prev ? prev.filter(s => s.t !== 'w').length : 0) || (ex(exId).type === 'c' ? 1 : 3);
  return { exId, note: '', rest: null, sets: Array.from({ length: k }, () => newSet()) };
}
function defaultName(ts = Date.now()) { const h = new Date(ts).getHours(); return h < 11 ? 'Morning Workout' : h < 16 ? 'Afternoon Workout' : h < 21 ? 'Evening Workout' : 'Night Workout'; }
const busyMsg = () => S.active.edit ? 'Save or discard your edit first' : 'Finish your current workout first';
function startWorkout(r) {
  if (S.active) { toast(busyMsg(), 'alert'); closeAllSheets(); openWorkout(); return; }
  S.active = { id: uid(), name: r ? r.name : defaultName(), start: Date.now(), rest: 0, restT: null, notes: '', routineId: r && r.id || null, exercises: r ? r.items.map(it => newWE(it.exId, it.sets)) : [] };
  S.active.exercises.forEach(e => e._new = true);
  saveNow(); closeAllSheets(); render(); openWorkout(); Haptic.success();
}
// Edit a finished workout, or log one you forgot to track (w = null). Reuses the live workout screen.
function editWorkout(w) {
  if (S.active) { toast(busyMsg(), 'alert'); closeAllSheets(); openWorkout(); return; }
  const start = w ? w.start : Math.floor((Date.now() - 36e5) / 6e4) * 6e4;
  S.active = {
    id: w ? w.id : uid(), name: w ? w.name : defaultName(start), start, dur: w ? Math.max(60, Math.round((w.end - w.start) / 1000)) : 3600,
    rest: w ? w.rest || 0 : 0, restT: null, notes: w ? w.notes || '' : '', routineId: w ? w.routineId || null : null, edit: { id: w ? w.id : null },
    exercises: w ? w.exercises.map(e => ({ exId: e.exId, note: e.note || '', rest: null, sets: e.sets.map(s => ({ ...s, pr: false, done: true })) })) : [],
  };
  saveNow(); closeAllSheets(); render(); openWorkout();
}
const woEnd = A => A.edit ? A.start + A.dur * 1000 : Date.now();
function openWorkout() {
  if (!S.active) return;
  renderWorkout();
  requestAnimationFrame(() => { $('#workout').classList.add('open'); updateMini(); });
  wake();
}
function minimizeWorkout() { $('#workout').classList.remove('open'); render(); }
function woStatsHtml() {
  const A = S.active, st = wStats({ ...A, end: woEnd(A) });
  const rest = A.rest + (A.restT ? Math.min(Date.now() - A.restT.start, A.restT.dur * 1000 + 6e5) / 1000 : 0);
  const items = st.cardioSec && !st.vol
    ? [['Cardio', fmtDur(st.cardioSec)], [dunit(), st.dist ? fmtD(st.dist) : '0'], ['Sets', st.sets], ['Rest', fmtDur(rest)]]
    : [['Volume', fmtVol(st.vol)], ['Sets', st.sets], ['Reps', st.reps], ['Rest', fmtDur(rest)]];
  return items.map(([l, v]) => `<div class="ws"><b>${v}</b><small>${l}</small></div>`).join('');
}
function woProgress() { let d = 0, t = 0; for (const e of S.active.exercises) for (const s of e.sets) { t++; if (s.done) d++; } return t ? d / t : 0; }
const exCnt = e => { const t = e.sets.length, d = e.sets.filter(s => s.done).length; return `<span class="ex-cnt ${t && d === t ? 'full' : ''}">${d}/${t}</span>`; };
function updateWoStats() {
  const A = S.active; if (!A) return;
  const s = $('#woStats'); if (s) s.innerHTML = woStatsHtml();
  const p = $('#woProg'); if (p) p.style.transform = `scaleX(${woProgress()})`;
  $$('#workout .ex-card').forEach((c, i) => { const e = A.exercises[i], n = $('.ex-cnt', c); if (e && n) n.outerHTML = exCnt(e); });
}
const dtVal = ts => { const d = new Date(ts); return `${dayKey(ts)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function renderWorkout() {
  const A = S.active; if (!A) return;
  const ed = A.edit, el = $('#workout'), old = $('.wo-scroll', el), top = old ? old.scrollTop : 0;
  el.classList.toggle('editing', !!ed);
  el.innerHTML = `
  <div class="wo-head">
    <button class="icon-btn" data-a="woMin" aria-label="Minimize">${I('down')}</button>
    <div class="wo-title"><input class="wo-name" aria-label="Workout name" data-f="woName" value="${esc(A.name)}" maxlength="40" enterkeyhint="done"><div class="wo-clock mono" id="woClock">${ed ? (ed.id ? 'Editing workout' : 'Logging a past workout') : fmtClock((Date.now() - A.start) / 1000)}</div></div>
    ${ed ? '' : `<button class="icon-btn" data-a="restToggle" aria-label="Rest timer">${I('timer')}</button>`}
    <button class="btn-finish" data-a="woFinish">${ed ? 'Save' : 'Finish'}</button>
    <div class="wo-prog"><i id="woProg" style="transform:scaleX(${woProgress()})"></i></div>
  </div>
  <div class="wo-scroll">
    <div class="wo-stats" id="woStats">${woStatsHtml()}</div>
    ${ed ? `<div class="two edit-meta"><label class="field"><span>Started</span><input class="inp" type="datetime-local" data-f="woStart" value="${dtVal(A.start)}" max="${dtVal(Date.now())}"></label><label class="field"><span>Duration (min)</span><input class="inp" inputmode="numeric" data-f="woDur" value="${Math.round(A.dur / 60)}"></label></div>` : ''}
    ${A.exercises.length ? A.exercises.map(exCard).join('') : emptyState('dumbbell', ed ? 'No exercises' : 'Empty workout', ed ? 'Add the exercises you did and tick each set.' : 'Add your first exercise to get going.')}
    <button class="btn-primary" data-a="woAddEx">${I('plus')} Add exercise</button>
    <textarea class="wo-notes" aria-label="Workout notes" data-f="woNotes" rows="2" placeholder="Workout notes">${esc(A.notes)}</textarea>
    <button class="btn-ghost danger" data-a="woCancel">${ed ? 'Discard changes' : 'Discard workout'}</button>
  </div>
  <div class="rest-dock" id="restDock"></div>`;
  A.exercises.forEach(e => delete e._new);
  $('.wo-scroll', el).scrollTop = top;
  renderRest(); bindSwipes();
}
const gridCls = x => x.type === 't' ? 'gt' : x.type === 'c' && x.extra ? 'g3' : 'g2';
function exCols(x) {
  if (x.type === 'c') return ['MIN', dunit().toUpperCase(), ...(x.extra ? [EXTRAS[x.extra].col] : [])];
  if (x.type === 't') return ['SEC', ''];
  return [(x.type === 'bw' ? '+' : '') + unit().toUpperCase(), 'REPS'];
}
function lastNote(exId, before = Infinity) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    if (S.workouts[i].start >= before) continue;
    const e = S.workouts[i].exercises.find(e => e.exId === exId);
    if (e) return e.note || '';
  }
  return '';
}
function exCard(e, i) {
  const A = S.active, before = A.edit ? A.start : Infinity, x = ex(e.exId), prev = lastSets(e.exId, before), g = gridCls(x);
  const restTxt = e.rest != null ? ` · ${e.rest ? fmtClock(e.rest) + ' rest' : 'no rest timer'}` : '';
  const ln = e.note ? '' : lastNote(e.exId, before);
  return `<div class="ex-card ${e._new ? 'new' : ''}" style="--mc:${MUSCLES[x.muscle] || '#fff'}">
    <div class="ex-head">${etile(x.muscle)}<div class="ex-name" data-a="exInfo" data-id="${x.id}">${esc(x.name)}<small>${x.muscle} · ${esc(x.equip)}${restTxt}</small></div>${exCnt(e)}<button class="icon-btn sm" data-a="exMenu" data-ei="${i}" aria-label="Exercise options">${I('dots')}</button></div>
    <input class="ex-note" aria-label="Note for ${esc(x.name)}" data-f="exNote" data-ei="${i}" value="${esc(e.note)}" placeholder="${esc(ln ? 'Last time: ' + ln : 'Add a note')}">
    <div class="set-inner hdr ${g}"><span>SET</span><span>PREVIOUS</span>${exCols(x).map(c => `<span>${c}</span>`).join('')}<span>${I('check')}</span></div>
    ${e.sets.map((s, si) => setRow(x, e, s, i, si, prevFor(e, si, prev))).join('')}
    <button class="btn-addset" data-a="addSet" data-ei="${i}">${I('plus')} Add set</button>
  </div>`;
}
// Match warm-ups to past warm-ups and working sets to past working sets.
function prevFor(e, si, prev) {
  if (!prev) return null;
  const wu = e.sets[si].t === 'w', same = s => (s.t === 'w') === wu;
  return prev.filter(same)[e.sets.slice(0, si).filter(same).length] || null;
}
function setRow(x, e, s, ei, si, p) {
  const at = `data-ei="${ei}" data-si="${si}"`, A = S.active;
  const LBL = { w: unit(), r: 'reps', sec: x.type === 'c' ? 'minutes' : 'seconds', dist: dunit(), inc: 'incline percent', lvl: 'level' };
  const inp = (k, v, ph, mode = 'decimal') => `<input class="set-in" type="text" inputmode="${mode}" aria-label="Set ${setLabel(e, si)} ${LBL[k]}" data-f="set" data-k="${k}" ${at} value="${v}" placeholder="${ph}" autocomplete="off">`;
  const nv = v => v == null ? '' : v;
  let ins;
  if (x.type === 'c') {
    ins = inp('sec', s.sec != null ? r1(s.sec / 60) : '', p && p.sec ? r1(p.sec / 60) : '') + inp('dist', s.dist != null ? r2(kmTo(s.dist)) : '', p && p.dist ? r2(kmTo(p.dist)) : '');
    if (x.extra) ins += inp(x.extra, nv(s[x.extra]), p && p[x.extra] != null ? p[x.extra] : '');
  } else if (x.type === 't') {
    const on = A.hold && A.hold.ei === ei && A.hold.si === si;
    ins = inp('sec', nv(s.sec), p && p.sec ? p.sec : '', 'numeric') + `<button class="set-hold ${on ? 'on' : ''}" data-a="hold" data-nohap ${at} aria-label="${on ? 'Stop' : 'Start'} hold timer">${I(on ? 'stop' : 'play')}</button>`;
  } else ins = inp('w', s.w != null ? r1(kgTo(s.w)) : '', p && p.w != null ? r1(kgTo(p.w)) : '') + inp('r', nv(s.r), p && p.r ? p.r : '', 'numeric');
  return `<div class="set-row ${s.done ? 'done' : ''} ${s.pr ? 'is-pr' : ''}" ${at}>
    <div class="set-del">${I('trash')}</div>
    <div class="set-inner ${gridCls(x)}">
      <button class="set-type t-${s.t}" data-a="setType" ${at}>${setLabel(e, si)}</button>
      <button class="set-prev" data-a="usePrev" ${at}>${p ? setTxt(x, p, true) : '-'}</button>
      ${ins}
      <button class="set-check" data-a="setDone" data-nohap ${at} aria-label="Complete set">${I(s.pr ? 'trophy' : 'check')}</button>
    </div></div>`;
}
function bindSwipes() {
  $$('#workout .set-row').forEach(rowEl => {
    const inner = $('.set-inner', rowEl);
    let x0 = 0, y0 = 0, dx = 0, lock = null;
    rowEl.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; lock = null; }, { passive: true });
    rowEl.addEventListener('touchmove', e => {
      const t = e.touches[0], ddx = t.clientX - x0, ddy = t.clientY - y0;
      if (lock === null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) { lock = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y'; if (lock === 'x') { inner.style.transition = 'none'; rowEl.classList.add('swiping'); } }
      if (lock !== 'x') return;
      dx = Math.min(0, ddx);
      inner.style.transform = `translateX(${dx}px)`;
      const armed = dx < -90;
      if (armed !== rowEl.classList.contains('arm')) { rowEl.classList.toggle('arm', armed); if (armed) Haptic.light(); }
    }, { passive: true });
    rowEl.addEventListener('touchend', () => {
      if (lock !== 'x') return;
      inner.style.transition = '';
      if (dx < -90) { rowEl.classList.add('removing'); Haptic.medium(); setTimeout(() => deleteSet(+rowEl.dataset.ei, +rowEl.dataset.si), 230); }
      else { inner.style.transform = ''; rowEl.classList.remove('arm'); setTimeout(() => rowEl.classList.remove('swiping'), 300); }
    });
  });
}
function deleteSet(ei, si) {
  const A = S.active, e = A && A.exercises[ei]; if (!e) return;
  const [s] = e.sets.splice(si, 1); A.hold = null; save(); renderWorkout();
  undoToast('Set deleted', () => { if (S.active !== A || !A.exercises.includes(e)) return; e.sets.splice(Math.min(si, e.sets.length), 0, s); save(); renderWorkout(); });
}

/* rest timer */
function startRest(sec) {
  const A = S.active; if (!A || !sec || A.edit) return;
  stopRest();
  const now = Date.now();
  A.restT = { start: now, end: now + sec * 1000, dur: sec, fired: false };
  lastBeep = -1; save(); renderRest();
}
function stopRest() {
  const A = S.active; if (!A || !A.restT) return;
  A.rest += Math.min(Date.now() - A.restT.start, A.restT.dur * 1000 + 6e5) / 1000;
  A.restT = null; save();
}
function renderRest() {
  const d = $('#restDock'); if (!d) return;
  const R = S.active && S.active.restT;
  d.classList.remove('over');
  $$('#workout [data-a="restToggle"]').forEach(b => b.classList.toggle('on', !!R));
  if (!R) { d.classList.remove('show'); return; }
  d.innerHTML = `<div class="rest-ring"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" class="rr-bg"/><circle id="restArc" cx="24" cy="24" r="20" class="rr-fg" pathLength="100" stroke-dasharray="100 100" transform="rotate(-90 24 24)"/></svg>${I('timer')}</div>
    <div class="rest-mid"><small id="restLbl">Rest</small><b id="restTime" class="mono">${fmtClock(R.dur)}</b></div>
    <button class="rest-btn" data-a="restAdj" data-d="-15">-15</button><button class="rest-btn" data-a="restAdj" data-d="15">+15</button><button class="rest-btn skip" data-a="restSkip">Skip</button>`;
  d.classList.add('show'); tick();
}
let lastBeep = -1, holdBeep = 0;
function tickHold(A, now) {
  const H = A.hold; if (!H) return;
  const inp = $(`#workout .set-row[data-ei="${H.ei}"][data-si="${H.si}"] .set-in`), t = (now - H.t0) / 1000;
  if (t < 0) {
    const c = Math.ceil(-t);
    if (inp) { inp.value = c + '…'; inp.classList.add('ready'); }
    if (c !== holdBeep) { holdBeep = c; Sound.tick(); }
  } else {
    if (holdBeep !== 0) { holdBeep = 0; Sound.go(); Haptic.medium(); }
    if (inp) { inp.value = Math.floor(t); inp.classList.remove('ready'); }
  }
}
function tick() {
  const A = S.active; if (!A) return;
  const now = Date.now(), mr = $('#miniRest');
  if (A.edit) { if (mr) mr.textContent = 'Editing · tap to return'; return; }
  const el = fmtClock((now - A.start) / 1000);
  const c = $('#woClock'); if (c) c.textContent = el;
  const mc = $('#miniClock'); if (mc) mc.textContent = el;
  $$('[data-clock]').forEach(n => n.textContent = el);
  tickHold(A, now);
  const R = A.restT;
  if (!R) { if (mr) mr.textContent = A.hold ? 'Hold timer running' : 'Tap to return'; return; }
  const left = (R.end - now) / 1000;
  const t = $('#restTime'), arc = $('#restArc'), lbl = $('#restLbl'), dock = $('#restDock');
  if (t) t.textContent = left >= 0 ? fmtClock(Math.ceil(left)) : '+' + fmtClock(-left);
  if (arc) arc.setAttribute('stroke-dasharray', `${clamp(left / R.dur * 100, 0, 100).toFixed(2)} 100`);
  if (mr) mr.textContent = left >= 0 ? `Resting · ${fmtClock(Math.ceil(left))} left` : `Rest over · +${fmtClock(-left)}`;
  if (left > 0 && left <= 3 && Math.ceil(left) !== lastBeep) { lastBeep = Math.ceil(left); Sound.tick(); }
  if (left <= 0) {
    if (dock) dock.classList.add('over');
    if (lbl) lbl.textContent = 'Rest over';
    if (!R.fired) { R.fired = true; save(); if (now - R.end < 5000) { Sound.done(); Haptic.heavy(); toast('Rest over. Next set!', 'bolt'); } }
  }
  if (left < -600) { stopRest(); renderRest(); }
}
function updateMini() {
  const m = $('#minibar'), show = !!S.active && !$('#workout').classList.contains('open');
  document.body.classList.toggle('has-mini', show);
  document.body.classList.toggle('has-active', !!S.active);
  if (show) m.innerHTML = `<button class="mini" data-a="woOpen"><span class="pulse"></span><span class="mini-t"><b>${esc(S.active.name)}</b><small id="miniRest">Tap to return</small></span><span class="mono mini-clock" id="miniClock"></span>${I('up')}</button>`;
  m.classList.toggle('show', show);
  tick();
}
let wakeLock = null;
async function wake() { if (!S.settings.wake || !S.active || S.active.edit || !('wakeLock' in navigator)) return; try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { } }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) { } wakeLock = null; }

function finishWorkout() {
  const A = S.active, ed = A.edit; stopRest();
  const w = {
    id: A.id, name: A.name.trim() || 'Workout', start: A.start, end: woEnd(A), rest: Math.round(A.rest), notes: A.notes, routineId: A.routineId,
    exercises: A.exercises.map(e => ({ exId: e.exId, note: e.note, sets: e.sets.filter(s => s.done).map(s => ({ ...s, pr: false })) })).filter(e => e.sets.length),
  };
  if (ed && ed.id) S.workouts = S.workouts.filter(x => x.id !== ed.id);
  S.workouts.push(w); recomputePRs();
  S.active = null; saveNow(); releaseWake();
  $('#workout').classList.remove('open');
  render();
  if (!ed) return showSummary(w);
  toast(ed.id ? 'Workout updated' : 'Workout logged');
  WD = w.id; sheet(vWDetail, { cls: 'tall' });
}
function discardWorkout() {
  const A = S.active; S.active = null; saveNow(); releaseWake(); $('#workout').classList.remove('open'); render();
  if (A.edit) return toast('Changes discarded', 'trash');
  undoToast('Workout discarded', () => { if (S.active) return toast(busyMsg(), 'alert'); S.active = A; saveNow(); render(); openWorkout(); });
}
function showSummary(w) {
  const st = wStats(w), prev = S.workouts.filter(o => o.id !== w.id && o.name === w.name && o.start < w.start).pop();
  const ws = weekAgg(weekStart(Date.now())), g = S.settings.goal;
  const kcal = w.exercises.reduce((n, e) => n + e.sets.reduce((m, s) => m + cardioKcal(ex(e.exId), s, w.start), 0), 0);
  const cardio = st.cardioSec > 0 && !st.vol;
  const tiles = cardio
    ? tileC('Duration', st.dur, 'dur') + tileC('Cardio', st.cardioSec, 'dur') + tile('Distance', `${fmtD(st.dist)} <i>${dunit()}</i>`) + (kcal ? tileC('Calories', kcal, 'int') : tileC('Sets', st.sets, 'int')) + tileC('Rest', st.rest, 'dur') + tileC('Active', Math.max(0, st.dur - st.rest), 'dur')
    : tileC('Duration', st.dur, 'dur') + tileC('Volume', st.vol, 'vol', ` <i>${unit()}</i>`) + tileC('Sets', st.sets, 'int') + tileC('Reps', st.reps, 'int') + tileC('Rest', st.rest, 'dur') + tileC('Active', Math.max(0, st.dur - st.rest), 'dur');
  sheet(() => `<div class="summary">
    ${barbellSVG(ws.count, g, 'lift')}
    <h2>${w.prs.length ? 'New record day!' : 'Workout complete'}</h2><p class="muted">${esc(w.name)} · ${fmtDate(w.start)} · plate ${ws.count} of ${g} loaded</p>
    <div class="tiles t3">${tiles}</div>
    ${prev && !cardio ? `<div class="cmp">Volume vs last ${esc(w.name)} ${delta(st.vol, wStats(prev).vol)}</div>` : ''}
    ${w.prs.length ? `<div class="card"><div class="card-h"><b>Personal records</b></div>${w.prs.map(p => `<div class="pr-row"><span>🏆</span><b>${esc(ex(p.exId).name)}</b><span>${prTxt(p)}</span></div>`).join('')}</div>` : ''}
    <p class="foot" style="margin:14px 0">${heroMsg(ws.count, g)}</p>
    <button class="btn-primary" data-a="closeSheet">Done</button>
    ${!w.routineId ? `<button class="btn-ghost" data-a="saveRoutineFrom" data-id="${w.id}">Save as routine</button>` : ''}
  </div>`, { cls: 'tall' });
  setTimeout(() => { confetti(w.prs.length ? 170 : 100); if (w.prs.length) Sound.pr(); else Sound.done(); }, 350);
}

/* ---------- picker ---------- */
function openPicker(cb, mode = 'multi') { PK = { q: '', m: 'All', sel: [], cb, mode }; sheet(vPicker, { cls: 'tall' }); }
function vPicker() {
  const ms = ['All', ...Object.keys(MUSCLES)];
  return `${sheetHead(PK.mode === 'browse' ? 'Exercises' : PK.mode === 'single' ? 'Choose exercise' : 'Add exercises', `${allEx().length} in library`, `<button class="link" data-a="customEx">+ Custom</button>`)}
  <div class="search">${I('search')}<input data-f="pkQ" aria-label="Search exercises" placeholder="Search exercises or equipment" value="${esc(PK.q)}" autocomplete="off" enterkeyhint="search"></div>
  <div class="chips">${ms.map(m => `<button class="chip ${PK.m === m ? 'on' : ''}" data-a="pkM" data-v="${m}" ${MUSCLES[m] ? `style="--mc:${MUSCLES[m]}"` : ''}>${m}</button>`).join('')}</div>
  <div id="pkList">${pkList()}</div>
  ${PK.mode === 'multi' ? `<div class="sheet-foot"><button class="btn-primary" id="pkGo" data-a="pkGo" ${PK.sel.length ? '' : 'disabled'}>${pkLabel()}</button></div>` : ''}`;
}
const pkLabel = () => PK.sel.length ? `Add ${PK.sel.length} exercise${PK.sel.length > 1 ? 's' : ''}` : 'Select exercises';
function recentEx(n = 6) {
  const out = [];
  for (let i = S.workouts.length - 1; i >= 0 && out.length < n; i--) for (const e of S.workouts[i].exercises) if (!out.includes(e.exId) && EXMAP[e.exId] && out.length < n) out.push(e.exId);
  return out.map(id => EXMAP[id]);
}
function pkList() {
  const q = PK.q.trim().toLowerCase();
  const list = allEx().filter(e => (PK.m === 'All' || e.muscle === PK.m) && (!q || e.name.toLowerCase().includes(q) || e.equip.toLowerCase().includes(q)));
  if (!list.length) return `<p class="muted pad">No matches. Tap <b>+ Custom</b> to create it.</p>`;
  const rowHtml = e => {
    const i = PK.sel.indexOf(e.id);
    return `<div class="pk-row ${i >= 0 ? 'on' : ''}" data-a="pkTog" data-id="${e.id}" >${etile(e.muscle)}<div><b>${esc(e.name)}</b><small>${e.muscle} · ${esc(e.equip)}${e.extra ? ' · ' + EXTRAS[e.extra].label : ''}${e.custom ? ' · Custom' : ''}</small></div>${PK.mode === 'browse' ? I('right') : `<span class="pk-n">${i >= 0 ? i + 1 : ''}</span>`}</div>`;
  };
  const rec = !q && PK.m === 'All' ? recentEx() : [];
  if (!rec.length) return list.map(rowHtml).join('');
  return `<p class="pk-sec">Recently used</p>${rec.map(rowHtml).join('')}<p class="pk-sec">All exercises</p>${list.map(rowHtml).join('')}`;
}
function vCustomEx() {
  const chips = (k, opts) => `<div class="chips wrap">${opts.map(([v, l]) => `<button class="chip ${CX[k] === v ? 'on' : ''}" data-a="cxSet" data-k="${k}" data-v="${v}" ${k === 'muscle' ? `style="--mc:${MUSCLES[v]}"` : ''}>${l}</button>`).join('')}</div>`;
  return `${sheetHead('Custom exercise', '', `<button class="link" data-a="cxSave">Save</button>`)}
  <label class="field"><span>Name</span><input class="inp" data-f="cxName" value="${esc(CX.name)}" placeholder="e.g. Landmine Press" maxlength="40"></label>
  <label class="field"><span>Equipment</span><input class="inp" data-f="cxEquip" value="${esc(CX.equip)}" placeholder="e.g. Barbell, Machine" maxlength="24"></label>
  <div class="field"><span>Muscle group</span>${chips('muscle', Object.keys(MUSCLES).map(m => [m, m]))}</div>
  <div class="field"><span>Tracking</span>${chips('type', Object.entries(TYPES))}</div>
  ${CX.type === 'c' ? `<div class="field"><span>Extra field</span>${chips('extra', [['', 'None'], ['inc', 'Incline %'], ['lvl', 'Level']])}</div>` : ''}
  <button class="btn-primary mt" data-a="cxSave">Create exercise</button>`;
}

/* ---------- exercise detail ---------- */
function vExInfo() {
  const x = ex(EI), ss = [];
  for (const w of S.workouts) { const e = w.exercises.find(e => e.exId === EI); if (e) ss.push({ ts: w.start, all: e.sets, sets: e.sets.filter(s => s.t !== 'w') }); }
  const head = sheetHead(esc(x.name), `${x.muscle} · ${esc(x.equip)} · ${TYPES[x.type]}${x.extra ? ' + ' + EXTRAS[x.extra].label.toLowerCase() : ''}`);
  const del = x.custom ? `<button class="btn-ghost danger" data-a="cxDelete" data-id="${x.id}">Delete custom exercise</button>` : '';
  if (!ss.length) return head + emptyState('chart', 'No history yet', 'Log this exercise and your charts, best sets and records appear here.') + del;
  let tiles = '', pts = [], extra = '', label = '';
  const all = ss.flatMap(s => s.sets);
  if (x.type === 'w') {
    label = `Estimated 1RM (${unit()})`;
    pts = ss.map(s => ({ x: s.ts, y: kgTo(Math.max(0, ...s.sets.map(z => e1rm(z.w, z.r)))) })).filter(p => p.y > 0);
    const best = all.reduce((b, z) => e1rm(z.w, z.r) > e1rm(b.w, b.r) ? z : b, all[0]);
    const heavy = Math.max(0, ...all.map(z => z.w || 0)), bestVol = Math.max(0, ...ss.map(s => s.sets.reduce((v, z) => v + (z.w || 0) * (z.r || 0), 0)));
    tiles = tile('Est. 1RM', `${fmtW(e1rm(best.w, best.r))} <i class="muted sm">${unit()}</i>`) + tile('Heaviest', `${fmtW(heavy)} <i class="muted sm">${unit()}</i>`) + tile('Best set', setTxt(x, best)) + tile('Best session', `${fmtVol(bestVol)} <i class="muted sm">${unit()}</i>`);
    extra = `<div class="card"><div class="card-h"><b>Rep records</b><span class="muted sm">heaviest weight</span></div><div class="rm-grid">${[1, 3, 5, 8, 10, 12].map(n => { const b = Math.max(0, ...all.filter(z => (z.r || 0) >= n).map(z => z.w || 0)); return `<div class="rm"><small>${n} REP${n > 1 ? 'S' : ''}</small><b>${b ? fmtW(b) : '-'}</b></div>`; }).join('')}</div></div>`;
  } else if (x.type === 'bw') {
    label = 'Max reps per session';
    pts = ss.map(s => ({ x: s.ts, y: Math.max(0, ...s.sets.map(z => z.r || 0)) }));
    tiles = tile('Max reps', Math.max(0, ...all.map(z => z.r || 0))) + tile('Total reps', all.reduce((a, z) => a + (z.r || 0), 0)) + tile('Sessions', ss.length) + tile('Max added', all.some(z => z.w) ? `${fmtW(Math.max(...all.map(z => z.w || 0)))} ${unit()}` : '-');
  } else if (x.type === 'c') {
    const hasD = all.some(z => z.dist);
    label = hasD ? `Distance (${dunit()})` : 'Minutes';
    pts = ss.map(s => ({ x: s.ts, y: hasD ? kmTo(s.sets.reduce((a, z) => a + (z.dist || 0), 0)) : s.sets.reduce((a, z) => a + (z.sec || 0), 0) / 60 }));
    const paces = all.filter(z => z.dist && z.sec).map(z => z.sec / kmTo(z.dist));
    tiles = tile('Longest', hasD ? `${fmtD(Math.max(...all.map(z => z.dist || 0)))} ${dunit()}` : fmtDur(Math.max(...all.map(z => z.sec || 0)))) + tile('Total time', fmtDur(all.reduce((a, z) => a + (z.sec || 0), 0))) + tile('Total distance', `${fmtD(all.reduce((a, z) => a + (z.dist || 0), 0))} ${dunit()}`) + tile('Best pace', paces.length ? `${fmtClock(Math.min(...paces))}/${dunit()}` : '-');
    const xv = x.extra ? all.map(z => z[x.extra]).filter(v => v > 0) : [];
    if (xv.length) { const X = EXTRAS[x.extra]; tiles += tile(`Avg ${X.label.toLowerCase()}`, fmtN(xv.reduce((a, b) => a + b, 0) / xv.length) + X.unit) + tile(`Max ${X.label.toLowerCase()}`, fmtN(Math.max(...xv)) + X.unit); }
  } else {
    label = 'Longest hold (sec)';
    pts = ss.map(s => ({ x: s.ts, y: Math.max(0, ...s.sets.map(z => z.sec || 0)) }));
    tiles = tile('Longest hold', fmtClock(Math.max(0, ...all.map(z => z.sec || 0)))) + tile('Sessions', ss.length);
  }
  return `${head}<div class="tiles">${tiles}</div>
  <div class="card"><div class="card-h"><b>${label}</b><span class="muted sm">${ss.length} sessions</span></div>${lineChart(pts)}</div>
  ${extra}
  <div class="card"><div class="card-h"><b>History</b></div>${ss.slice(-20).reverse().map(s => `<div class="h-row"><span>${fmtDate(s.ts, { month: 'short', day: 'numeric' })}</span><div>${s.all.map(z => `<i class="${z.t === 'w' ? 'wu' : ''}">${setTxt(x, z)}</i>`).join('')}</div></div>`).join('')}</div>${del}`;
}

/* ---------- workout detail ---------- */
function vWDetail() {
  const w = S.workouts.find(x => x.id === WD); if (!w) return '';
  const st = wStats(w), t = d => intl(Intl.DateTimeFormat, { hour: 'numeric', minute: '2-digit' }).format(d);
  const kcal = w.exercises.reduce((n, e) => n + e.sets.reduce((m, s) => m + cardioKcal(ex(e.exId), s, w.start), 0), 0);
  return `${sheetHead(esc(w.name), `${fmtDate(w.start, { weekday: 'long', month: 'long', day: 'numeric' })} · ${t(w.start)} - ${t(w.end)}`)}
  <div class="tiles t3">${st.cardioSec && !st.vol
    ? tile('Duration', fmtDur(st.dur)) + tile('Cardio', fmtDur(st.cardioSec)) + tile('Distance', `${fmtD(st.dist)} <i>${dunit()}</i>`) + tile(kcal ? 'Calories' : 'Sets', kcal ? Math.round(kcal) : st.sets) + tile('Rest', fmtDur(st.rest)) + tile('Active', fmtDur(Math.max(0, st.dur - st.rest)))
    : tile('Duration', fmtDur(st.dur)) + tile('Volume', fmtVol(st.vol) + ' ' + unit()) + tile('Sets', st.sets) + tile('Reps', st.reps) + tile('Rest', fmtDur(st.rest)) + tile('PRs', (w.prs || []).length)}</div>
  ${w.exercises.map(e => {
    const x = ex(e.exId);
    return `<div class="card d-ex"><div class="ex-head">${etile(x.muscle, 'sm')}<div class="ex-name" data-a="exInfo" data-id="${x.id}">${esc(x.name)}<small>${x.muscle}</small></div></div>${e.note ? `<p class="muted sm" style="padding:0 4px 6px">${esc(e.note)}</p>` : ''}
    ${e.sets.map((s, i) => `<div class="d-set ${s.pr ? 'pr' : ''}"><span class="set-type t-${s.t}">${setLabel(e, i)}</span><b>${setTxt(x, s)}</b>${x.type === 'w' && s.w && s.r ? `<small>e1RM ${fmtW(e1rm(s.w, s.r))}</small>` : x.type === 'c' && cardioMeta(x, s, w.start) ? `<small class="cm">${cardioMeta(x, s, w.start)}</small>` : ''}${s.pr ? I('trophy') : ''}</div>`).join('')}</div>`;
  }).join('')}
  ${w.notes ? `<div class="card"><small class="muted">Notes</small><p>${esc(w.notes)}</p></div>` : ''}
  <button class="btn-primary" data-a="repeatW" data-id="${w.id}">${I('copy')} Repeat workout</button>
  <button class="btn-ghost" data-a="editW" data-id="${w.id}">${I('edit')} Edit workout</button>
  <button class="btn-ghost" data-a="saveRoutineFrom" data-id="${w.id}">Save as routine</button>
  <button class="btn-ghost danger" data-a="delW" data-id="${w.id}">Delete workout</button>`;
}

/* ---------- routines ---------- */
const routineRow = r => `<div class="card r-row" data-a="editRoutine" data-id="${r.id}"><div><b>${esc(r.name)}</b><small>${r.items.map(it => esc(ex(it.exId).name)).join(' · ') || 'No exercises'}</small></div><button class="icon-btn sm go" data-a="startRoutine" data-id="${r.id}">${I('play')}</button></div>`;
const vRoutines = () => `${sheetHead('Routines', `${S.routines.length} saved`, `<button class="icon-btn sm" data-a="newRoutine">${I('plus')}</button>`)}${S.routines.length ? S.routines.map(routineRow).join('') : emptyState('list', 'No routines', 'Create one to start workouts in a tap.')}`;
const vStart = () => `${sheetHead('Start workout', fmtDate(Date.now(), { weekday: 'long', month: 'short', day: 'numeric' }))}
  <button class="btn-primary big" data-a="startEmpty">${I('play')} Empty workout</button>
  <button class="btn-ghost" data-a="logPast">${I('history')} Log a past workout</button>
  <div class="sec-h" style="margin-top:22px"><h2>Routines</h2><button class="link" data-a="newRoutine">+ New</button></div>
  ${S.routines.map(routineRow).join('') || '<p class="muted">No routines yet.</p>'}`;
function openRoutineEditor(id) {
  const r = id && S.routines.find(r => r.id === id);
  RE = r ? JSON.parse(JSON.stringify(r)) : { id: uid(), name: '', items: [] };
  RE._new = !r;
  sheet(vRoutineEd, { cls: 'tall' });
}
function vRoutineEd() {
  return `${sheetHead(RE._new ? 'New routine' : 'Edit routine', `${RE.items.length} exercises`, `<button class="link" data-a="reSave">Save</button>`)}
  <label class="field"><span>Name</span><input class="inp" data-f="reName" value="${esc(RE.name)}" placeholder="e.g. Upper Body A" maxlength="40"></label>
  <div>${RE.items.map((it, i) => {
    const x = ex(it.exId);
    return `<div class="re-item">${etile(x.muscle, 'sm')}<div class="re-n"><b>${esc(x.name)}</b><small>${it.sets} set${it.sets > 1 ? 's' : ''} · ${x.muscle}</small></div>
      <div class="stp"><button data-a="reSets" data-i="${i}" data-d="-1" aria-label="Fewer sets">${I('minus')}</button><span style="min-width:20px">${it.sets}</span><button data-a="reSets" data-i="${i}" data-d="1" aria-label="More sets">${I('plus')}</button></div>
      <div class="re-mv"><button data-a="reMove" data-i="${i}" data-d="-1" aria-label="Move up" ${i ? '' : 'disabled'}>${I('up')}</button><button data-a="reMove" data-i="${i}" data-d="1" aria-label="Move down" ${i < RE.items.length - 1 ? '' : 'disabled'}>${I('down')}</button></div>
      <button class="icon-btn sm danger" data-a="reDel" data-i="${i}" aria-label="Remove ${esc(x.name)}">${I('x')}</button></div>`;
  }).join('') || '<p class="muted pad">No exercises yet.</p>'}</div>
  <button class="btn-ghost" data-a="reAdd">${I('plus')} Add exercises</button>
  ${RE.items.length ? `<button class="btn-primary mt" data-a="reStart">${I('play')} Save & start</button>` : ''}
  ${RE._new ? '' : `<button class="btn-ghost danger" data-a="reDelete">Delete routine</button>`}`;
}

/* ---------- body weight / tools ---------- */
function vBodyLog() {
  return `${sheetHead('Log body weight')}
  <input class="bw-in mono" id="bwIn" aria-label="Body weight in ${unit()}" data-f="bwV" inputmode="decimal" value="${BWV.v}"><div class="bw-unit">${unit()}</div>
  <div class="bw-steps">${[-1, -.1, .1, 1].map(d => `<button data-a="bwStep" data-d="${d}">${d > 0 ? '+' : ''}${d}</button>`).join('')}</div>
  <label class="field"><span>Date</span><input class="inp" type="date" data-f="bwD" value="${BWV.d}" max="${dayKey(Date.now())}"></label>
  <button class="btn-primary" data-a="bwSave">${I('check')} Save</button>`;
}
function vPlates() {
  const kg = unit() === 'kg', bars = kg ? [20, 15, 10] : [45, 35, 15];
  return `${sheetHead('Plate calculator', 'Plates per side')}
  <label class="field"><span>Target weight (${unit()})</span><input class="inp" inputmode="decimal" data-f="pcT" value="${PC.t}"></label>
  <div class="field"><span>Bar</span><div class="chips wrap">${bars.map(b => `<button class="chip ${PC.bar === b ? 'on' : ''}" data-a="pcBar" data-v="${b}">${b} ${unit()}</button>`).join('')}</div></div>
  <div id="pcOut">${pcOut()}</div>`;
}
function pcOut() {
  const kg = unit() === 'kg', plates = kg ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5];
  // Standard competition plate colours, in the app's palette.
  const col = kg ? { 25: '#E5483B', 20: '#3F6FE0', 15: '#E8B419', 10: '#2BA676', 5: '#EDEAE0', 2.5: '#1E3B32', 1.25: '#A39E8F' } : { 45: '#3F6FE0', 35: '#E8B419', 25: '#2BA676', 10: '#EDEAE0', 5: '#E5483B', 2.5: '#A39E8F' };
  const t = parseFloat(String(PC.t).replace(',', '.')) || 0, side = (t - PC.bar) / 2;
  if (side < 0) return `<p class="muted pad">Target is lighter than the bar.</p>`;
  const used = []; let rem = side;
  for (const p of plates) while (rem >= p - 1e-9) { used.push(p); rem = r2(rem - p); }
  const vis = used.map((p, i) => `<div class="plate" style="height:${40 + p / plates[0] * 90}px;background:${col[p]};animation-delay:${i * 40}ms"></div>`).join('');
  return `<div class="barbell"><div class="bb-shaft"></div><div class="bb-sleeve"></div>${vis}<div class="bb-sleeve" style="width:30px"></div></div>
  <p class="pc-txt">${used.length ? `Each side: <b>${used.join(' + ')}</b> ${unit()}` : 'Just the bar'}</p>
  ${rem > 0 ? `<p class="pc-txt" style="color:var(--gold)">${fmtN(rem * 2)} ${unit()} can't be loaded with standard plates.</p>` : ''}`;
}
function vOrm() {
  return `${sheetHead('1RM calculator', 'Estimated with the Epley formula')}
  <div class="two"><label class="field"><span>Weight (${unit()})</span><input class="inp" inputmode="decimal" data-f="ormW" value="${OR.w}" placeholder="100"></label><label class="field"><span>Reps</span><input class="inp" inputmode="numeric" data-f="ormR" value="${OR.r}" placeholder="5"></label></div>
  <div id="ormOut">${ormOut()}</div>`;
}
function ormOut() {
  const w = parseFloat(String(OR.w).replace(',', '.')) || 0, r = parseInt(OR.r) || 0;
  if (!w || !r) return '<p class="muted pad">Enter a weight and the reps you managed.</p>';
  const m = e1rm(w, r);
  return `<div class="orm-big"><small>Estimated 1RM</small><b>${fmtN(m)}</b><i>${unit()}</i></div>
  <div class="list">${[100, 95, 90, 85, 80, 75, 70, 65, 60].map(p => `<div class="pct-row"><span>${p}%</span><b>${fmtN(m * p / 100)} ${unit()}</b><small>~${p === 100 ? 1 : Math.round(30 * (100 / p - 1))} reps</small></div>`).join('')}</div>`;
}

/* ---------- data ---------- */
// Returns true when the file was handed to the share sheet or downloaded, false if the user cancelled.
async function shareFile(text, name, type) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; }
  } catch (e) { if (e.name === 'AbortError') return false; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}
async function exportJson() {
  const ok = await shareFile(JSON.stringify({ app: 'forge', exported: new Date().toISOString(), data: S }), `forge-backup-${dayKey(Date.now())}.json`, 'application/json');
  if (!ok) return;
  S.settings.lastBackup = Date.now(); saveNow(); render(); toast('Backup saved', 'check');
}
function exportCsv() {
  const rows = [['date', 'workout', 'exercise', 'set', 'type', 'weight_' + unit(), 'reps', 'seconds', 'distance_' + dunit(), 'incline_pct', 'level', 'duration_min', 'rest_min']];
  for (const w of S.workouts) for (const e of w.exercises) e.sets.forEach((s, i) => rows.push([
    new Date(w.start).toISOString(), w.name, ex(e.exId).name, i + 1, s.t, s.w != null ? r1(kgTo(s.w)) : '', s.r ?? '', s.sec ?? '', s.dist != null ? r2(kmTo(s.dist)) : '', s.inc ?? '', s.lvl ?? '', r1((w.end - w.start) / 60000), r1((w.rest || 0) / 60),
  ]));
  // Text starting with = + - @ would run as a formula in Excel/Numbers, so prefix it with an apostrophe.
  const cell = v => { v = String(v); if (/^[=+\-@\t\r]/.test(v) && isNaN(+v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = rows.map(r => r.map(cell).join(',')).join('\n');
  shareFile(csv, `forge-${dayKey(Date.now())}.csv`, 'text/csv');
}

/* ---------- theme & onboarding ---------- */
function applyTheme() {
  const t = S.settings.theme, root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  $$('meta[name="theme-color"]').forEach(m => { m.content = t === 'dark' ? '#0F1311' : t === 'light' ? '#F2EEE4' : (m.media.includes('dark') ? '#0F1311' : '#F2EEE4'); });
}
const OB = { step: 0 };
function renderOnboard() {
  const s = S.settings, dots = [0, 1, 2].map(i => `<i class="${i === OB.step ? 'on' : ''}"></i>`).join('');
  const back = `<button class="btn-ghost" data-a="obBack" aria-label="Back">‹</button>`;
  const ms = (k, opts) => `<div class="mseg">${opts.map(v => `<button class="${s[k] === v ? 'on' : ''}" data-a="obUnit" data-k="${k}" data-v="${v}">${v}</button>`).join('')}</div>`;
  const steps = [
    () => `<div class="ob-hero">${barbellSVG(7, 7)}</div>
      <h1 class="ob-title">Lift. Log.<br><em>Level up.</em></h1>
      <p class="ob-text">Forge tracks every set, rest and run, then tells you <b>how your week stacked up</b>. Free, private, and it lives on your phone.</p>
      <div class="ob-actions"><button class="btn-primary big" data-a="obNext">Let's go</button></div>`,
    () => `<h1 class="ob-title">First, the <em>basics.</em></h1>
      <label class="field"><span>What should we call you?</span><input class="inp" data-f="name" value="${esc(s.name)}" placeholder="Your name" maxlength="24" autocomplete="given-name"></label>
      <div class="list"><div class="row"><span class="row-ic">⚖️</span><span class="row-l">Weights in</span>${ms('unit', ['kg', 'lb'])}</div><div class="row"><span class="row-ic">📏</span><span class="row-l">Distance in</span>${ms('dist', ['km', 'mi'])}</div></div>
      <div class="ob-actions">${back}<button class="btn-primary" data-a="obNext">Continue</button></div>`,
    () => `<h1 class="ob-title">How often will you <em>train?</em></h1>
      <p class="ob-text">Each workout loads a plate on your bar. Fill the bar to hit your weekly goal.</p>
      <div class="goal-grid">${[2, 3, 4, 5, 6, 7].map(n => `<button class="${s.goal === n ? 'on' : ''}" data-a="obGoal" data-v="${n}">${n}</button>`).join('')}</div>
      <div class="ob-hero" style="margin-top:18px">${barbellSVG(s.goal, s.goal)}</div>
      <div class="ob-actions">${back}<button class="btn-primary lime" data-a="obDone">Start training</button></div>`,
  ];
  $('#onboard').innerHTML = `<div class="ob-dots">${dots}</div><div class="ob-step ${OB.shown !== OB.step ? 'anim' : ''}">${steps[OB.step]()}</div>`;
  OB.shown = OB.step;
}
function finishOnboard() {
  S.settings.onboarded = true; saveNow(); Haptic.success();
  const ob = $('#onboard'); ob.classList.add('leaving');
  render(true);
  setTimeout(() => { document.body.classList.remove('onboarding'); ob.classList.remove('leaving'); ob.innerHTML = ''; }, 480);
}

/* ---------- actions ---------- */
const exAt = a => S.active.exercises[+a.dataset.ei];
const ACT = {
  tab: a => { tab = a.dataset.tab; if (a.dataset.prog) progTab = a.dataset.prog; closeAllSheets(); render(true); scrollTo(0, 0); },
  closeSheet: () => closeSheet(),
  confirmOk: () => { const f = CONFIRM; CONFIRM = null; closeSheet(); f && f(); },
  hideInstall: () => { S.settings.hideInstall = true; save(); render(); },
  seg: a => {
    if (a.dataset.v === progTab) return;
    progTab = a.dataset.v;
    const sg = $('#seg-prog'); sg.style.setProperty('--i', [...sg.querySelectorAll('button')].indexOf(a));
    $$('button', sg).forEach(b => b.classList.toggle('on', b === a));
    const pb = $('#progBody'); pb.innerHTML = progBody(); afterRender(pb);
  },
  review: (a, e) => { e.stopPropagation(); RV = +a.dataset.ws; sheet(vReview, { cls: 'tall' }); },
  revNav: a => { const n = addDays(RV, 7 * +a.dataset.d); if (n > weekStart(Date.now())) return; RV = n; refreshSheet(); },
  startMenu: () => S.active ? openWorkout() : sheet(vStart),
  startEmpty: () => startWorkout(null),
  startRoutine: a => { const r = S.routines.find(r => r.id === a.dataset.id); if (r) startWorkout(r); },
  newRoutine: () => openRoutineEditor(null),
  editRoutine: a => openRoutineEditor(a.dataset.id),
  routines: () => sheet(vRoutines, { cls: 'tall' }),
  library: () => openPicker(null, 'browse'),
  woOpen: () => openWorkout(),
  woMin: () => minimizeWorkout(),
  woAddEx: () => openPicker(ids => {
    ids.forEach(id => { const e = newWE(id); e._new = true; S.active.exercises.push(e); });
    save(); renderWorkout();
    setTimeout(() => { const sc = $('.wo-scroll'); sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); }, 80);
  }),
  woFinish: () => {
    const A = S.active, total = A.exercises.reduce((n, e) => n + e.sets.length, 0), done = A.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
    if (!done) return confirmSheet('No completed sets', 'Tick off at least one set to save this workout, or discard it.', 'Discard workout', discardWorkout, true);
    if (done < total) return confirmSheet('Finish workout?', `${total - done} unfinished set${total - done > 1 ? 's' : ''} will be left out.`, 'Finish workout', () => { Haptic.success(); finishWorkout(); });
    Haptic.success(); finishWorkout();
  },
  woCancel: () => S.active.edit ? confirmSheet('Discard changes?', 'The workout stays exactly as it was before you started editing.', 'Discard changes', discardWorkout, true) : confirmSheet('Discard workout?', 'Everything logged in this session will be lost.', 'Discard', discardWorkout, true),
  exInfo: a => { EI = a.dataset.id; sheet(vExInfo, { cls: 'tall' }); },
  exMenu: a => {
    const ei = +a.dataset.ei;
    sheet(() => {
      const e = S.active.exercises[ei]; if (!e) return '';
      const x = ex(e.exId), cur = e.rest != null ? e.rest : (x.type === 'c' ? 0 : S.settings.rest);
      return `${sheetHead(esc(x.name), x.muscle)}
      <div class="list">${row('chart', 'History & records', '', 'exInfo', `data-id="${x.id}"`)}${x.type === 'w' ? row('flame', 'Add warm-up sets', '', 'warmup', `data-ei="${ei}"`) : ''}${x.type === 'w' && x.equip === 'Barbell' ? row('plate', 'Plate calculator', '', 'platesFor', `data-ei="${ei}"`) : ''}${ei > 0 ? row('up', 'Move up', '', 'exMove', `data-ei="${ei}" data-d="-1"`) : ''}${ei < S.active.exercises.length - 1 ? row('down', 'Move down', '', 'exMove', `data-ei="${ei}" data-d="1"`) : ''}${row('swap', 'Replace exercise', '', 'exReplace', `data-ei="${ei}"`)}${row('trash', '<span class="danger">Remove exercise</span>', '', 'exRemove', `data-ei="${ei}"`)}</div>
      <div class="field"><span>Rest timer for this exercise</span><div class="chips wrap">${[0, 30, 60, 90, 120, 150, 180, 240, 300].map(s => `<button class="chip ${cur === s ? 'on' : ''}" data-a="exRest" data-ei="${ei}" data-v="${s}">${s ? fmtClock(s) : 'Off'}</button>`).join('')}</div></div>`;
    });
  },
  exRest: a => { exAt(a).rest = +a.dataset.v; save(); refreshSheet(); renderWorkout(); },
  exMove: a => { const i = +a.dataset.ei, j = i + +a.dataset.d, E = S.active.exercises; [E[i], E[j]] = [E[j], E[i]]; S.active.hold = null; save(); closeSheet(); renderWorkout(); },
  exReplace: a => { const e = exAt(a); closeSheet(); openPicker(ids => { e.exId = ids[0]; e.sets = e.sets.map(() => newSet()); e.rest = null; S.active.hold = null; save(); renderWorkout(); }, 'single'); },
  exRemove: a => {
    const ei = +a.dataset.ei, A = S.active;
    confirmSheet('Remove exercise?', 'Its sets in this workout will be deleted.', 'Remove', () => {
      closeSheet(); const [e] = A.exercises.splice(ei, 1); A.hold = null; save(); renderWorkout();
      undoToast(`${ex(e.exId).name} removed`, () => { if (S.active !== A) return; A.exercises.splice(Math.min(ei, A.exercises.length), 0, e); save(); renderWorkout(); });
    }, true);
  },
  warmup: a => {
    const e = exAt(a), prev = lastSets(e.exId) || [], work = e.sets.find(s => s.t !== 'w' && s.w) || prev.find(s => s.t !== 'w' && s.w);
    if (!work) return toast('Enter a working weight first', 'alert');
    const base = work.w, bar = unit() === 'kg' ? 20 : 45 / LB, step = unit() === 'kg' ? 2.5 : 5, rw = kg => toKg(Math.round(kgTo(kg) / step) * step);
    const ws = [];
    for (const [p, r] of [[0, 10], [.4, 5], [.6, 3], [.8, 2]]) {
      const w = p ? Math.max(bar, rw(base * p)) : bar;
      if (w >= base - 1e-6 || (ws.length && w <= ws[ws.length - 1].w + 1e-6)) continue;
      ws.push({ ...newSet('w'), w, r });
    }
    if (!ws.length) return toast('Too light for warm-ups', 'alert');
    e.sets = [...ws, ...e.sets.filter(s => !(s.t === 'w' && !s.done))];
    save(); closeSheet(); renderWorkout(); toast(`${ws.length} warm-up sets added`, 'flame');
  },
  addSet: a => {
    const ei = +a.dataset.ei, e = S.active.exercises[ei], l = e.sets[e.sets.length - 1];
    e.sets.push(l ? { ...newSet(l.t === 'w' ? 'n' : l.t), w: l.w, r: l.r, sec: l.sec, dist: l.dist, inc: l.inc ?? null, lvl: l.lvl ?? null } : newSet());
    save(); renderWorkout();
    const rows = $$('.ex-card')[ei].querySelectorAll('.set-row'); rows[rows.length - 1].classList.add('new');
  },
  setType: a => { const s = exAt(a).sets[+a.dataset.si], o = ['n', 'w', 'd', 'f']; s.t = o[(o.indexOf(s.t) + 1) % 4]; save(); renderWorkout(); },
  usePrev: a => { $$('.set-in', a.closest('.set-row')).forEach(inp => { if (inp.placeholder !== '') { inp.value = inp.placeholder; INPUTS.set(inp); } }); },
  setDone: a => {
    const A = S.active, ei = +a.dataset.ei, si = +a.dataset.si, e = A.exercises[ei], s = e.sets[si], x = ex(e.exId), rowEl = a.closest('.set-row');
    if (A.hold && A.hold.ei === ei && A.hold.si === si) return ACT.hold($('.set-hold', rowEl));
    if (s.done) { s.done = false; s.pr = false; rowEl.classList.remove('done', 'is-pr'); a.innerHTML = I('check'); Haptic.light(); save(); updateWoStats(); return; }
    $$('.set-in', rowEl).forEach(inp => { if (inp.value === '' && inp.placeholder !== '') { inp.value = inp.placeholder; INPUTS.set(inp); } });
    const ok = x.type === 'c' ? (s.sec > 0 || s.dist > 0) : x.type === 't' ? s.sec > 0 : s.r > 0;
    if (!ok) { rowEl.classList.remove('shake'); void rowEl.offsetWidth; rowEl.classList.add('shake'); Haptic.error(); toast(x.type === 'c' || x.type === 't' ? 'Enter a time first' : 'Enter your reps first', 'alert'); return; }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    s.done = true; rowEl.classList.add('done'); Haptic.medium();
    if ((x.type === 'w' || x.type === 'bw') && s.t !== 'w') {
      const sc = setScore(x, s), hist = bestScore(e.exId, A.edit ? A.start : Infinity), inWo = Math.max(0, ...e.sets.filter((z, j) => j !== si && z.done && z.t !== 'w').map(z => setScore(x, z)));
      if (hist > 0 && sc > hist && sc > inWo) { s.pr = true; rowEl.classList.add('is-pr'); a.innerHTML = I('trophy'); setTimeout(() => { Haptic.success(); Sound.pr(); confetti(70); }, 60); toast(`New PR: ${x.name}`, 'trophy'); }
    }
    save(); updateWoStats();
    const rest = e.rest != null ? e.rest : (x.type === 'c' ? 0 : S.settings.rest);
    if (S.settings.autoRest && rest && !A.edit) startRest(rest);
  },
  restAdj: a => { const R = S.active.restT; if (!R) return; const d = +a.dataset.d; R.end += d * 1000; R.dur = Math.max(1, R.dur + d); if (R.end > Date.now()) { R.fired = false; $('#restDock').classList.remove('over'); const l = $('#restLbl'); if (l) l.textContent = 'Rest'; } save(); tick(); },
  restSkip: () => { stopRest(); renderRest(); updateWoStats(); },
  restToggle: () => { if (S.active.restT) { stopRest(); renderRest(); updateWoStats(); } else startRest(S.settings.rest || 90); },
  // Timed holds: 3-second countdown, then counts up. Tap again (or the tick) to stop and complete the set.
  hold: a => {
    const A = S.active, ei = +a.dataset.ei, si = +a.dataset.si, H = A.hold;
    if (H && H.ei === ei && H.si === si) {
      const sec = Math.max(0, Math.round((Date.now() - H.t0) / 1000)), s = A.exercises[ei].sets[si];
      A.hold = null;
      if (sec > 0) s.sec = sec;
      save(); renderWorkout(); Haptic.medium();
      const btn = $(`#workout .set-row[data-ei="${ei}"][data-si="${si}"] .set-check`);
      if (sec > 0 && btn && !s.done) ACT.setDone(btn);
      return;
    }
    stopRest(); renderRest();
    A.hold = { ei, si, t0: Date.now() + 3000 }; holdBeep = 99;
    save(); renderWorkout(); Haptic.light(); tick();
  },
  editW: a => { const w = S.workouts.find(w => w.id === a.dataset.id); if (w) editWorkout(w); },
  logPast: () => editWorkout(null),
  snoozeBackup: (a, e) => { e.stopPropagation(); S.settings.backupSnooze = Date.now() - 7 * DAY; save(); render(); toast('Okay, I will remind you next week', 'check'); },
  cxDelete: a => {
    const id = a.dataset.id, x = ex(id), used = S.workouts.filter(w => w.exercises.some(e => e.exId === id)).length + S.routines.filter(r => r.items.some(i => i.exId === id)).length + (S.active && S.active.exercises.some(e => e.exId === id) ? 1 : 0);
    if (used) return toast(`${x.name} is used in ${used} workout${used > 1 ? 's or routines' : ' or routine'}`, 'alert');
    confirmSheet('Delete exercise?', `"${esc(x.name)}" will be removed from your library.`, 'Delete', () => { S.custom = S.custom.filter(c => c.id !== id); rebuildEx(); save(); closeSheet(); refreshSheet(); toast('Exercise deleted', 'trash'); }, true);
  },
  platesFor: a => {
    const e = exAt(a), work = [...e.sets].reverse().find(s => s.t !== 'w' && s.w) || (lastSets(e.exId) || []).find(s => s.t !== 'w' && s.w);
    closeSheet();
    PC = { t: work ? r1(kgTo(work.w)) : unit() === 'kg' ? 100 : 225, bar: unit() === 'kg' ? 20 : 45 };
    sheet(vPlates);
  },
  histMore: () => { histN += 120; render(); },
  wDetail: a => { WD = a.dataset.id; sheet(vWDetail, { cls: 'tall' }); },
  repeatW: a => { const w = S.workouts.find(w => w.id === a.dataset.id); startWorkout({ id: w.routineId, name: w.name, items: w.exercises.map(e => ({ exId: e.exId, sets: e.sets.filter(s => s.t !== 'w').length || 1 })) }); },
  delW: a => confirmSheet('Delete workout?', 'Its sets and records will be removed from your history.', 'Delete', () => {
    const w = S.workouts.find(w => w.id === a.dataset.id); if (!w) return;
    S.workouts = S.workouts.filter(x => x !== w); recomputePRs(); save(); closeAllSheets(); render();
    undoToast('Workout deleted', () => { if (S.workouts.some(x => x.id === w.id)) return; S.workouts.push(w); recomputePRs(); save(); render(); });
  }, true),
  saveRoutineFrom: a => { const w = S.workouts.find(w => w.id === a.dataset.id); S.routines.push({ id: uid(), name: w.name, items: w.exercises.map(e => ({ exId: e.exId, sets: e.sets.filter(s => s.t !== 'w').length || 1 })) }); save(); render(); toast('Saved as routine', 'list'); },
  // picker
  pkM: a => { PK.m = a.dataset.v; $$('.chip[data-a="pkM"]').forEach(c => c.classList.toggle('on', c === a)); $('#pkList').innerHTML = pkList(); },
  pkTog: a => {
    const id = a.dataset.id;
    if (PK.mode === 'browse') { EI = id; sheet(vExInfo, { cls: 'tall' }); return; }
    if (PK.mode === 'single') { PK.sel = [id]; ACT.pkGo(); return; }
    const i = PK.sel.indexOf(id);
    if (i >= 0) PK.sel.splice(i, 1); else PK.sel.push(id);
    $('#pkList').innerHTML = pkList();
    const b = $('#pkGo'); if (b) { b.disabled = !PK.sel.length; b.textContent = pkLabel(); }
  },
  pkGo: () => { const ids = PK.sel.slice(), cb = PK.cb; if (!ids.length) return; closeSheet(); cb && cb(ids); },
  customEx: () => { CX = { name: PK.q, equip: '', muscle: PK.m !== 'All' ? PK.m : 'Chest', type: PK.m === 'Cardio' ? 'c' : 'w', extra: '' }; sheet(vCustomEx); },
  cxSet: a => { CX[a.dataset.k] = a.dataset.v; refreshSheet(); },
  cxSave: () => {
    if (!CX.name.trim()) return toast('Give it a name', 'alert');
    const id = 'c-' + uid();
    S.custom.push({ id, name: CX.name.trim(), equip: CX.equip.trim() || 'Other', muscle: CX.muscle, type: CX.type, extra: CX.type === 'c' && CX.extra ? CX.extra : null, custom: true });
    rebuildEx(); save(); closeSheet();
    if (PK.mode === 'multi') PK.sel.push(id);
    PK.q = ''; refreshSheet(); toast('Exercise created');
  },
  // routine editor
  reSets: a => { const it = RE.items[+a.dataset.i]; it.sets = clamp(it.sets + +a.dataset.d, 1, 10); refreshSheet(); },
  reMove: a => { const i = +a.dataset.i, j = i + +a.dataset.d; [RE.items[i], RE.items[j]] = [RE.items[j], RE.items[i]]; refreshSheet(); },
  reDel: a => { RE.items.splice(+a.dataset.i, 1); refreshSheet(); },
  reAdd: () => openPicker(ids => { ids.forEach(id => RE.items.push({ exId: id, sets: ex(id).type === 'c' ? 1 : 3 })); refreshSheet(); }),
  reSave: () => {
    if (!RE.items.length) { toast('Add at least one exercise', 'alert'); return null; }
    const r = { id: RE.id, name: RE.name.trim() || 'My Routine', items: RE.items };
    const i = S.routines.findIndex(x => x.id === r.id);
    if (i >= 0) S.routines[i] = r; else S.routines.push(r);
    save(); closeSheet(); refreshSheet(); render(); toast('Routine saved', 'list');
    return r;
  },
  reStart: () => { const r = ACT.reSave(); if (r) startWorkout(r); },
  reDelete: () => confirmSheet('Delete routine?', `"${esc(RE.name)}" will be removed. Past workouts stay.`, 'Delete', () => { S.routines = S.routines.filter(r => r.id !== RE.id); save(); closeSheet(); refreshSheet(); render(); }, true),
  // body
  logBody: (a, e) => { e.stopPropagation(); const l = S.body[S.body.length - 1]; BWV = { v: l ? r1(kgTo(l.w)) : (unit() === 'kg' ? 75 : 165), d: dayKey(Date.now()) }; sheet(vBodyLog); },
  bwStep: a => { BWV.v = r1((parseFloat(String(BWV.v).replace(',', '.')) || 0) + +a.dataset.d); $('#bwIn').value = BWV.v; },
  bwSave: () => {
    const v = parseFloat(String(BWV.v).replace(',', '.'));
    if (!v || v <= 0) return toast('Enter a valid weight', 'alert');
    const d = keyToTs(BWV.d || dayKey(Date.now()));
    S.body = S.body.filter(e => e.d !== d); S.body.push({ d, w: toKg(v) }); S.body.sort((a, b) => a.d - b.d);
    save(); closeSheet(); render(); Haptic.success(); toast('Weight logged', 'scale');
  },
  delBody: a => {
    const [b] = S.body.splice(+a.dataset.i, 1); save(); render();
    undoToast('Entry removed', () => { if (S.body.some(x => x.d === b.d)) return; S.body.push(b); S.body.sort((x, y) => x.d - y.d); save(); render(); });
  },
  // tools
  plates: () => { PC = { t: unit() === 'kg' ? 100 : 225, bar: unit() === 'kg' ? 20 : 45 }; sheet(vPlates); },
  pcBar: a => { PC.bar = +a.dataset.v; $$('.chip[data-a="pcBar"]').forEach(c => c.classList.toggle('on', c === a)); $('#pcOut').innerHTML = pcOut(); },
  orm: () => sheet(vOrm),
  // settings
  toggle: a => { const k = a.dataset.k; S.settings[k] = !S.settings[k]; a.classList.toggle('on', S.settings[k]); a.setAttribute('aria-checked', S.settings[k]); save(); if (k === 'wake') S.settings.wake ? wake() : releaseWake(); },
  setOpt: a => { S.settings[a.dataset.k] = a.dataset.v; save(); if (a.dataset.k === 'theme') applyTheme(); render(); if (S.active) renderWorkout(); },
  lift: a => { const bb = $('.bb', a); if (!bb) return; bb.classList.remove('lift'); void bb.getBoundingClientRect(); bb.classList.add('lift'); setTimeout(() => Haptic.light(), 220); },
  obNext: () => { OB.step++; renderOnboard(); },
  obBack: () => { OB.step--; renderOnboard(); },
  obUnit: a => { S.settings[a.dataset.k] = a.dataset.v; save(); renderOnboard(); },
  obGoal: a => { S.settings.goal = +a.dataset.v; save(); renderOnboard(); },
  obDone: () => finishOnboard(),
  step: a => {
    const k = a.dataset.k, d = +a.dataset.d;
    if (k === 'rest') S.settings.rest = clamp(S.settings.rest + d * 15, 0, 600);
    else S.settings.goal = clamp(S.settings.goal + d, 1, 14);
    save(); $('#stp-' + k).textContent = k === 'rest' ? restLbl(S.settings.rest) : S.settings.goal + ' / wk';
  },
  exportJson: (a, e) => { e.stopPropagation(); exportJson(); },
  exportCsv: () => exportCsv(),
  importJson: () => $('#importFile').click(),
  reset: () => confirmSheet('Erase everything?', 'All workouts, routines and body weight entries will be deleted from this device. Export a backup first if unsure.', 'Erase all data', () => { S = defaults(); rebuildEx(); saveNow(); releaseWake(); $('#workout').classList.remove('open'); applyTheme(); render(true); OB.step = 0; document.body.classList.add('onboarding'); renderOnboard(); }, true),
};

const INPUTS = {
  name: t => { S.settings.name = t.value; save(); const av = $('.avatar'); if (av) av.textContent = (t.value || 'F').trim()[0]?.toUpperCase() || 'F'; },
  woName: t => { S.active.name = t.value; save(); },
  woNotes: t => { S.active.notes = t.value; save(); },
  woStart: t => { const v = new Date(t.value).getTime(); if (isNaN(v)) return; S.active.start = Math.min(v, Date.now()); save(); updateWoStats(); },
  woDur: t => { const m = parseInt(t.value); if (!m || m < 1) return; S.active.dur = Math.min(m, 600) * 60; save(); updateWoStats(); },
  exNote: t => { exAt(t).note = t.value; save(); },
  set: t => {
    const e = exAt(t), s = e.sets[+t.dataset.si], x = ex(e.exId), k = t.dataset.k;
    const v = parseFloat(t.value.replace(',', '.')), n = isNaN(v) ? null : Math.max(0, v);
    if (k === 'w') s.w = n == null ? null : toKg(n);
    else if (k === 'r') s.r = n == null ? null : Math.round(n);
    else if (k === 'sec') s.sec = n == null ? null : Math.round(x.type === 'c' ? n * 60 : n);
    else if (k === 'dist') s.dist = n == null ? null : toKm(n);
    else if (EXTRAS[k]) s[k] = n == null ? null : Math.min(r1(n), EXTRAS[k].max);
    save(); if (s.done) updateWoStats();
  },
  pkQ: t => { PK.q = t.value; $('#pkList').innerHTML = pkList(); },
  cxName: t => { CX.name = t.value; },
  cxEquip: t => { CX.equip = t.value; },
  reName: t => { RE.name = t.value; },
  bwV: t => { BWV.v = t.value; },
  bwD: t => { BWV.d = t.value; },
  pcT: t => { PC.t = t.value; $('#pcOut').innerHTML = pcOut(); },
  ormW: t => { OR.w = t.value; $('#ormOut').innerHTML = ormOut(); },
  ormR: t => { OR.r = t.value; $('#ormOut').innerHTML = ormOut(); },
};
const CHANGES = {
  import: async t => {
    const f = t.files[0]; t.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()), d = j.data || j;
      if (!Array.isArray(d.workouts)) throw new Error('bad file');
      confirmSheet('Restore backup?', `This replaces what is on this device with ${d.workouts.length} workouts from the file.`, 'Restore', () => { S = hydrate(d); rebuildEx(); recomputePRs(); saveNow(); render(true); if (S.active) openWorkout(); toast('Backup restored'); });
    } catch (e) { toast('That file is not a Forge backup', 'alert'); }
  },
};

document.addEventListener('click', e => {
  const a = e.target.closest('[data-a]'); if (!a) return;
  const fn = ACT[a.dataset.a]; if (!fn) return;
  if (!a.hasAttribute('data-nohap')) Haptic.light();
  fn(a, e);
});
document.addEventListener('input', e => { const f = e.target.dataset && e.target.dataset.f; if (f && INPUTS[f]) INPUTS[f](e.target); });
document.addEventListener('change', e => { const c = e.target.dataset && e.target.dataset.c; if (c && CHANGES[c]) CHANGES[c](e.target); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input:not([type=date]):not([type=datetime-local])')) e.target.blur(); });
document.addEventListener('focusin', e => { if (e.target.classList.contains('set-in')) setTimeout(() => e.target.select && e.target.select(), 0); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (S.active && $('#workout').classList.contains('open')) wake(); tick(); if (!S.active) render(); if (swReg) swReg.update().catch(() => { }); }
  else saveNow();
});

/* ---------- boot ---------- */
rebuildEx();
recomputePRs();
applyTheme();
if (!S.settings.onboarded && S.workouts.length) { S.settings.onboarded = true; save(); }
render(true);
if (!S.settings.onboarded) { document.body.classList.add('onboarding'); renderOnboard(); }
else if (S.active) openWorkout();
setInterval(tick, 250);
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
// Offline support. When a new version is published, offer a reload instead of silently running old code.
let swReg = null;
if ('serviceWorker' in navigator) {
  const hadSW = !!navigator.serviceWorker.controller;
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => { }));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadSW) return;
    toast('Forge has been updated', 'sparkle', { label: 'Reload', fn: () => { saveNow(); location.reload(); } });
  });
}
