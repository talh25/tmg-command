// Service worker: makes the app work offline.
// - App files and data: saved at install. Online, the newest copy is used (and saved); offline, or
//   when the network takes more than 3 seconds, the saved copy is used.
// - Media (voices, music, images): saved the first time each file is used, or all at once from Settings.
const VERSION = 'v2';
const SHELL_CACHE = 'tmg-shell-' + VERSION;
const MEDIA_CACHE = 'tmg-media-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
  'js/app.js', 'js/lib.js', 'js/audio.js', 'js/armies.js', 'js/game.js', 'js/ruletext.js', 'js/unitcard.js',
  'js/screens/home.js', 'js/screens/game.js', 'js/screens/tracker.js', 'js/screens/log.js', 'js/screens/armies.js', 'js/screens/codex.js',
  'js/screens/rules.js', 'js/screens/music.js', 'js/screens/settings.js',
  'army/index.html', 'data/army.json', 'data/media.json', 'data/media-files.json', 'data/rules.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tmg-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function shell(req) {
  const cache = await caches.open(SHELL_CACHE);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  const slow = new Promise((_, reject) => { setTimeout(reject, 3000); });
  try {
    return await Promise.race([fresh, slow]);
  } catch {
    fresh.catch(() => {});
    return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && (await cache.match('index.html'))) || fresh;
  }
}

const url = (req) => new URL(req.url).pathname;

async function media(req) {
  const cache = await caches.open(MEDIA_CACHE);
  let hit = await cache.match(req.url);
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') || '');
  if (!hit) {
    // Not saved yet. Audio players ask for byte ranges, and a partial answer can't be saved as the
    // file. Music is big, so it streams straight from the network (save it from Settings instead);
    // everything else is small, so fetch the whole file once, save it, and answer from that.
    if (range && url(req).includes('/audio/music/')) return fetch(req);
    const res = await fetch(req.url);
    if (res.status !== 200) return res;
    cache.put(req.url, res.clone());
    hit = res;
  }
  if (!range) return hit;
  // Audio players ask for byte ranges; answer them from the saved file.
  const body = await hit.arrayBuffer();
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : body.byteLength - 1, body.byteLength - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${body.byteLength}` } });
  return new Response(body.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': hit.headers.get('Content-Type') || 'audio/mp4', 'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${body.byteLength}`, 'Content-Length': String(end - start + 1) } });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(url.pathname.includes('/media/') ? media(e.request) : shell(e.request));
});
