// Settings: sound, saving the app for offline use, installing it, credits, and clearing saved data.
import { el, loadJson, confirmBox, toast } from '../lib.js';
import { prefs, refreshVolumes, MEDIA } from '../audio.js';

export const MEDIA_CACHE = 'tmg-media-v1';
const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
const isMusic = (path) => path.startsWith('audio/music/');

function slider(label, key) {
  return el('label.field', el('span', label),
    el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: prefs[key], oninput: (e) => { prefs[key] = Number(e.target.value); refreshVolumes(); } }));
}
function toggle(label, key, hint) {
  return el('label.toggle', el('input', { type: 'checkbox', checked: prefs[key], onchange: (e) => { prefs[key] = e.target.checked; refreshVolumes(); } }),
    el('span', el('b', label), hint ? el('small.muted', hint) : null));
}

/** Download media into the cache the service worker serves from. filter picks which files. */
async function saveOffline(filter, report) {
  const files = Object.keys(await loadJson('data/media-files.json')).filter(filter);
  await navigator.storage?.persist?.().catch(() => {});
  const cache = await caches.open(MEDIA_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const todo = files.filter((f) => !have.has(new URL(MEDIA + f, location.href).href));
  let done = files.length - todo.length, failed = 0;
  const worker = async () => {
    for (let f = todo.shift(); f; f = todo.shift()) {
      try {
        const r = await fetch(MEDIA + f);
        if (r.ok) await cache.put(MEDIA + f, r); else failed += 1;
      } catch { failed += 1; }
      done += 1;
      if (done % 20 === 0) report(`Saving… ${done} of ${files.length}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  report(failed ? `${failed} files failed. Tap again to retry.` : `All ${files.length} files are saved.`);
}

async function offlineStatus() {
  if (!('caches' in window)) return 'This browser cannot save files for offline use.';
  const all = await loadJson('data/media-files.json');
  const cache = await caches.open(MEDIA_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const saved = Object.keys(all).filter((f) => have.has(new URL(MEDIA + f, location.href).href));
  const bytes = saved.reduce((n, f) => n + all[f], 0);
  return saved.length ? `${saved.length} of ${Object.keys(all).length} sound and image files saved (${mb(bytes)}).` : 'Nothing saved yet. Sounds are fetched as you use them.';
}

function offlineCard() {
  const status = el('p.small.muted', 'Checking…');
  const report = (t) => { status.textContent = t; };
  offlineStatus().then(report).catch(() => report('Offline status is not available.'));
  const sizes = el('span');
  loadJson('data/media-files.json').then((all) => {
    const e = Object.entries(all);
    const sum = (f) => e.filter(([p]) => f(p)).reduce((n, [, b]) => n + b, 0);
    sizes.textContent = `Voices and images are ${mb(sum((p) => !isMusic(p)))}; music is another ${mb(sum(isMusic))}.`;
  }).catch(() => {});
  const run = (filter) => async (e) => {
    if (!('caches' in window) || !navigator.serviceWorker?.controller) { toast('Offline saving needs the app to be opened over HTTPS. Reload once and try again.'); return; }
    e.target.disabled = true;
    await saveOffline(filter, report).catch(() => report('Saving stopped. Check your connection and try again.'));
    e.target.disabled = false;
  };
  return el('section.card',
    el('h2', 'Use offline'),
    el('p.muted', 'The app, rules and unit data are saved the first time you open it. Save the sounds too so everything works with no signal at the table. ', sizes),
    el('div.row',
      el('button.btn.primary', { onclick: run((p) => !isMusic(p)) }, 'Save voices and images'),
      el('button.btn', { onclick: run(() => true) }, 'Save everything')),
    status,
    el('button.btn.small', { onclick: async () => { if (await confirmBox('Remove saved sounds?', 'They will be fetched again when needed.', 'Remove')) { await caches.delete(MEDIA_CACHE); report('Saved sounds removed.'); } } }, 'Remove saved sounds'));
}

function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return el('section.card',
    el('h2', 'Install'),
    standalone ? el('p.muted', 'Installed. You are running the app from your home screen.')
      : el('p.muted', ios ? 'In Safari, tap Share, then "Add to Home Screen".'
        : 'In Chrome or Edge, open the browser menu and choose "Install app" (Android: "Add to Home screen").'));
}

export function render() {
  return {
    title: 'Settings',
    node: el('div.page.narrow',
      el('section.card',
        el('h2', 'Sound'),
        toggle('Mute everything', 'muted'),
        toggle('Announcer', 'announcer', 'Calls out rounds, phases and the result.'),
        toggle('Unit voices', 'unitVoices', 'Units speak when deployed or destroyed, and on their cards.'),
        slider('Voice volume', 'voiceVolume'),
        slider('Music volume', 'musicVolume')),
      offlineCard(),
      installCard(),
      el('section.card',
        el('h2', 'About'),
        el('p.muted', 'TMG Command is a fan-made table companion for StarCraft: The Miniatures Game. It is not affiliated with or endorsed by Blizzard Entertainment or Archon Studio. StarCraft and its sounds, names and artwork belong to Blizzard Entertainment; the game rules belong to Archon Studio.')),
      el('section.card',
        el('h2', 'Saved data'),
        el('p.muted', 'Your game, army lists and settings are kept in this browser only.'),
        el('button.btn.danger', { onclick: async () => {
          if (await confirmBox('Clear the current game and settings?', 'Army lists are kept. This cannot be undone.', 'Clear')) {
            localStorage.removeItem('tmg.game'); localStorage.removeItem('tmg.prefs'); location.reload();
          }
        } }, 'Clear game and settings'))),
  };
}
