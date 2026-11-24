// Music: soundtrack playlists by game and faction. The mini-player at the bottom keeps playing on every screen.
import { el, FACTIONS, FACTION_NAME } from '../lib.js';
import { mediaData, playTracks, onPlayer, currentTrack, player } from '../audio.js';

export function render() {
  const m = mediaData()?.music;
  const node = el('div.page');
  if (!m) return { title: 'Music', node: el('div.page', el('p.muted', 'Music could not load.')) };
  const groups = [
    ['Menu themes', m.menu],
    ...['sc2', 'sc1'].flatMap((era) => FACTIONS.map((f) => [`${FACTION_NAME[f]} · ${era === 'sc2' ? 'StarCraft II' : 'StarCraft'}`, m[era][f]])),
  ].filter(([, list]) => list?.length);
  const everything = groups.flatMap(([, list]) => list);

  const draw = () => {
    const now = currentTrack();
    node.replaceChildren(
      el('div.row',
        el('button.btn.primary', { onclick: () => playTracks(everything, 0) }, 'Play all'),
        el('button.btn', { onclick: () => playTracks([...everything].sort(() => Math.random() - 0.5), 0) }, 'Shuffle')),
      ...groups.map(([name, list]) => el('section.card',
        el('h2', name),
        el('div.list', list.map((t, i) => el('button.list-row.track-row' + (now?.src === t.src ? '.on' : ''), { onclick: () => playTracks(list, i) },
          el('span', now?.src === t.src && player.playing ? '▮▮' : '▶'), el('b', t.title)))))));
  };
  draw();
  return { title: 'Music', node, cleanup: onPlayer(draw) };
}
