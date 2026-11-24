// Home: where the game stands, and the way into each part of the app.
import { el, FACTION_NAME, PHASES } from '../lib.js';
import { game, supplyPool, poolText } from '../game.js';
import { listRosters } from '../armies.js';

const tile = (href, title, text) => el('a.tile', { href }, el('b', title), el('span', text));

export function render() {
  const lists = listRosters().length;
  const status = game.started && !game.finished
    ? el('a.card.hero', { href: '#/game' },
      el('small.eyebrow', 'Game in progress'),
      el('h2', `Round ${game.round} of ${game.rounds} · ${PHASES[game.phase]}`),
      el('p', game.players.map((p) => `${p.name} (${FACTION_NAME[p.faction]}) ${p.score} VP`).join('  ·  ')),
      el('p.muted.small', `${game.mission} · Supply Pool ${poolText(supplyPool())}`),
      el('span.btn.primary', 'Continue'))
    : el('a.card.hero', { href: '#/game' },
      el('small.eyebrow', 'Ready'),
      el('h2', 'Start a game'),
      el('p.muted', 'Pick factions, army lists and a mission, then track rounds, supply, victory points and every unit\'s wounds.'),
      el('span.btn.primary', 'Set up a game'));
  return {
    title: 'TMG Command',
    node: el('div.page',
      status,
      el('div.tiles',
        tile('#/armies', 'Army lists', lists ? `${lists} saved ${lists === 1 ? 'list' : 'lists'}` : 'Build and save your lists'),
        tile('#/codex', 'Units and cards', 'Stats, weapons, abilities, voices'),
        tile('#/rules', 'Rulebook', 'Search the rules, glossary and FAQ'),
        tile('#/music', 'Music', 'Soundtracks for the table'),
        tile('#/settings', 'Settings', 'Sound, offline use, about')),
      el('p.small.muted.center', 'A fan-made table companion for StarCraft: The Miniatures Game. Not affiliated with Blizzard Entertainment or Archon Studio.')),
  };
}
