// Small shared helpers: DOM building, storage, data loading, dialogs.

export const FACTIONS = ['terran', 'protoss', 'zerg'];
export const FACTION_NAME = { terran: 'Terran', protoss: 'Protoss', zerg: 'Zerg' };
export const PHASES = ['Movement', 'Assault', 'Combat', 'Scoring & Cleanup'];
export const PHASE_KEY = ['movement', 'assault', 'combat', 'scoring'];

/**
 * Build an element: el('button.btn.primary', { onclick, 'aria-label': 'x' }, 'text', child, [more]).
 * Strings always become text nodes, so data can never inject markup.
 */
export function el(spec, props, ...kids) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) node.style.setProperty(sk, sv);
    else if (k === 'class') node.className += ' ' + v;
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  add(node, kids);
  return node;
}
function add(node, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(node, k); else node.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export const uid = () => Math.random().toString(36).slice(2, 10);

const lastPick = new Map();
/** Random pick that never repeats the previous pick for the same key. */
export function pickFresh(key, list) {
  if (!list?.length) return null;
  const prev = lastPick.get(key);
  const pool = list.length > 1 ? list.filter((x) => x !== prev) : list;
  const v = pick(pool);
  lastPick.set(key, v);
  return v;
}

// ---------- storage ----------
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
};

/** An object saved under one storage key. Top-level sets save by themselves; call save() after nested changes. */
export function saved(key, defaults) {
  const data = { ...structuredClone(defaults), ...(store.get(key, {}) || {}) };
  const save = () => store.set(key, data);
  const proxy = new Proxy(data, { set(t, k, v) { t[k] = v; save(); return true; } });
  return { state: proxy, save, reset() { for (const k of Object.keys(data)) delete data[k]; Object.assign(data, structuredClone(defaults)); save(); } };
}

// ---------- data ----------
const cache = new Map();
export function loadJson(path) {
  if (!cache.has(path)) {
    const p = fetch(path).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}

// ---------- feedback ----------
let toastTimer;
export function toast(message, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/** Open a dialog. build(close) returns its content. Returns close(). Escape and backdrop click close it. */
export function dialog(build, { wide = false, sheet = false } = {}) {
  const back = el('div.backdrop');
  const box = el('div.dialog' + (wide ? '.wide' : '') + (sheet ? '.sheet' : ''), { role: 'dialog', 'aria-modal': 'true' });
  const onKey = (e) => { if (e.key === 'Escape' && back === document.getElementById('modal-root').lastChild) close(); };
  function close() { back.remove(); document.removeEventListener('keydown', onKey); }
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  add(box, [build(close)]);
  back.append(box);
  document.getElementById('modal-root').append(back);
  return close;
}

export function confirmBox(title, body, okLabel = 'OK') {
  return new Promise((resolve) => {
    dialog((close) => [
      el('h3', title), el('p.muted', body),
      el('div.actions',
        el('button.btn', { onclick: () => { close(); resolve(false); } }, 'Cancel'),
        el('button.btn.primary', { onclick: () => { close(); resolve(true); } }, okLabel)),
    ]);
  });
}

/** − value + control. */
export function stepper(value, { min = 0, max = 99, onChange, label, big = false }) {
  const out = el('output', String(value));
  const set = (v) => { value = clamp(v, min, max); out.textContent = String(value); onChange(value); };
  return el('div.stepper' + (big ? '.big' : ''),
    el('button', { 'aria-label': `Less ${label || ''}`, onclick: () => set(value - 1) }, '−'), out,
    el('button', { 'aria-label': `More ${label || ''}`, onclick: () => set(value + 1) }, '+'));
}

/** Row of mutually exclusive buttons. options: [[value, label]] */
export function segmented(options, current, onPick, cls = '') {
  const wrap = el('div.seg' + (cls ? '.' + cls : ''), { role: 'tablist' });
  const draw = () => wrap.replaceChildren(...options.map(([v, label]) =>
    el('button' + (v === current ? '.on' : ''), { role: 'tab', 'aria-selected': String(v === current), onclick: () => { current = v; draw(); onPick(v); } }, label)));
  draw();
  return wrap;
}
