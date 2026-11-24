// App shell: navigation, hash routing (#/game, #/rules/8.7.4, ...), the music mini-player, offline setup.
import { el, toast } from './lib.js';
import { loadMedia, onPlayer, currentTrack, toggleMusic, skip, stopMusic } from './audio.js';
import { loadArmy } from './armies.js';
import { loadRules } from './ruletext.js';

const SCREENS = {
  '': () => import('./screens/home.js'),
  game: () => import('./screens/game.js'),
  armies: () => import('./screens/armies.js'),
  codex: () => import('./screens/codex.js'),
  rules: () => import('./screens/rules.js'),
  music: () => import('./screens/music.js'),
  settings: () => import('./screens/settings.js'),
};
const NAV = [
  ['', 'Home', 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  ['game', 'Game', 'M12 2l9 5v10l-9 5-9-5V7zM12 7v5l4 2'],
  ['armies', 'Armies', 'M4 5h16M4 12h16M4 19h10M18 16v6M15 19h6'],
  ['codex', 'Units', 'M5 3h11l3 3v15H5zM9 8h6M9 12h6M9 16h4'],
  ['rules', 'Rules', 'M4 4h7a3 3 0 0 1 1 2 3 3 0 0 1 1-2h7v15h-7a2 2 0 0 0-1 1 2 2 0 0 0-1-1H4zM12 6v14'],
  ['music', 'Music', 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
  ['settings', 'Settings', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 12h3M18 12h3M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1'],
];

export function icon(path, size = 22) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

/** Go to a route, e.g. go('rules', '8.7.4'). */
export function go(...parts) { location.hash = '#/' + parts.map(encodeURIComponent).join('/'); }
export const link = (parts, ...kids) => el('a', { href: '#/' + [].concat(parts).map(encodeURIComponent).join('/') }, ...kids);

const view = document.getElementById('view');
const topbar = document.getElementById('topbar');
let cleanup = null;
let drawn = 0;

function drawNav(active) {
  document.getElementById('nav').replaceChildren(
    el('a.brand', { href: '#/', 'aria-label': 'TMG Command home' }, el('img', { src: 'icons/icon.svg', alt: '', width: 34, height: 34 }), el('span', 'TMG Command')),
    ...NAV.map(([route, label, path]) => el('a.nav-item' + (route === active ? '.on' : ''),
      { href: '#/' + route, 'aria-current': route === active ? 'page' : null }, icon(path), el('span', label))));
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = SCREENS[parts[0] || ''] ? parts[0] || '' : '';
  const turn = ++drawn;
  drawNav(name);
  try {
    const mod = await SCREENS[name]();
    const screen = await mod.render(parts.slice(1));
    if (turn !== drawn) { screen.cleanup?.(); return; }   // the user moved on while this screen loaded
    cleanup?.();
    cleanup = screen.cleanup || null;
    document.title = screen.title ? `${screen.title} · TMG Command` : 'TMG Command';
    topbar.replaceChildren(el('h1', screen.title || 'TMG Command'), el('div.top-actions', screen.actions || []));
    view.className = screen.cls || '';
    view.replaceChildren(screen.node);
    if (!screen.keepScroll) view.scrollTop = 0;
  } catch (err) {
    console.error(err);
    view.replaceChildren(el('div.page', el('div.card', el('h3', 'This screen could not load'),
      el('p.muted', navigator.onLine ? String(err.message || err) : 'You are offline and this part is not saved yet.'),
      el('button.btn', { onclick: route }, 'Try again'))));
  }
}

function drawPlayer(p) {
  const bar = document.getElementById('player');
  const t = currentTrack();
  bar.classList.toggle('hidden', !t);
  document.body.classList.toggle('has-player', Boolean(t));
  if (!t) return;
  bar.replaceChildren(
    el('a.track', { href: '#/music' }, el('small', 'Now playing'), el('b', t.title)),
    el('button.icon-btn', { 'aria-label': 'Previous track', onclick: () => skip(-1) }, icon('M19 5v14L9 12zM6 5v14')),
    el('button.icon-btn', { 'aria-label': p.playing ? 'Pause' : 'Play', onclick: toggleMusic }, icon(p.playing ? 'M8 5v14M16 5v14' : 'M7 4l13 8-13 8z')),
    el('button.icon-btn', { 'aria-label': 'Next track', onclick: () => skip(1) }, icon('M5 5v14l10-7zM18 5v14')),
    el('button.icon-btn', { 'aria-label': 'Stop music', onclick: stopMusic }, icon('M6 6l12 12M18 6L6 18')));
}

async function boot() {
  onPlayer(drawPlayer);
  window.addEventListener('hashchange', route);
  await Promise.all([loadMedia(), loadArmy()]).catch(() => toast('Some data could not load. Check your connection.'));
  route();
  loadRules().catch(() => {});   // in the background: lets keywords on unit cards link to the glossary
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* works online without it */ });
  }
}
boot();
