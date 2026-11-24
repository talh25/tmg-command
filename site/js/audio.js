// Sound: one voice channel for unit lines and announcements, one music channel with a playlist.
import { saved, loadJson, pickFresh } from './lib.js';

export const MEDIA = 'media/';
export const { state: prefs } = saved('tmg.prefs', {
  voiceVolume: 1, musicVolume: 0.5, muted: false, announcer: true, unitVoices: true,
});

let media = null;
export async function loadMedia() { media = media || await loadJson('data/media.json'); return media; }
export const mediaData = () => media;

// ---------- voices ----------
const voice = new Audio();
voice.preload = 'auto';
let queue = [];
voice.addEventListener('ended', nextInQueue);
voice.addEventListener('error', nextInQueue);

function nextInQueue() {
  const src = queue.shift();
  if (!src) { duck(false); return; }
  voice.src = MEDIA + src;
  voice.volume = prefs.voiceVolume;
  duck(true);
  voice.play().catch(() => { queue = []; duck(false); });
}

/** Play one clip, or several one after another. Replaces whatever voice line is playing. */
export function say(...clips) {
  const list = clips.flat().filter(Boolean);
  if (prefs.muted || !list.length) return;
  queue = list;
  voice.pause();
  nextInQueue();
}
export function hush() { queue = []; voice.pause(); duck(false); }

/** A random line of one kind ('move' | 'attack' | 'death' | 'chatter' | 'tap') for a unit or building. */
export function unitLine(id, kind = 'move') {
  const entry = media?.units[id] || media?.buildings[id];
  const list = entry?.voices[kind] || entry?.voices.tap;
  const src = pickFresh(`${id}:${kind}`, list);
  if (src && prefs.unitVoices) say(src);
  return src;
}
export const hasVoice = (id) => Boolean(media?.units[id] || media?.buildings[id]);
export const labelFor = (src) => media?.labels[src] || '';

export function announce(...clips) { if (prefs.announcer) say(...clips); }

// ---------- music ----------
const music = new Audio();
music.preload = 'none';
const listeners = new Set();
export const player = { list: [], index: -1, playing: false };
let ducked = false;

const emit = () => listeners.forEach((fn) => fn(player));
export function onPlayer(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function applyVolume() { music.volume = prefs.muted ? 0 : prefs.musicVolume * (ducked ? 0.35 : 1); }
function duck(on) { ducked = on; applyVolume(); }

music.addEventListener('ended', () => skip(1));
music.addEventListener('play', () => { player.playing = true; emit(); });
music.addEventListener('pause', () => { player.playing = false; emit(); });

export const currentTrack = () => player.list[player.index] || null;

/** Start a playlist ([{src, title}]) at one track. */
export function playTracks(list, index = 0) {
  player.list = list;
  player.index = index;
  start();
}
function start() {
  const t = currentTrack();
  if (!t) return;
  music.src = MEDIA + t.src;
  applyVolume();
  music.play().catch(() => {});
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: 'TMG Command' });
    navigator.mediaSession.setActionHandler('nexttrack', () => skip(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1));
  }
  emit();
}
export function skip(step) {
  if (!player.list.length) return;
  player.index = (player.index + step + player.list.length) % player.list.length;
  start();
}
export function toggleMusic() {
  if (!currentTrack()) return;
  if (music.paused) music.play().catch(() => {}); else music.pause();
}
export function stopMusic() { music.pause(); player.list = []; player.index = -1; emit(); }

/** Re-apply volumes after a settings change. */
export function refreshVolumes() {
  voice.volume = prefs.voiceVolume;
  applyVolume();
  if (prefs.muted) hush();
}
