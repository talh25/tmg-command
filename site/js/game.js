// The game in progress: players, mission, round, phase, scores, tracked units. Saved on every change.
import { saved, clamp, FACTIONS, PHASES } from './lib.js';
import { condition } from './armies.js';

// Mission and Deployment Cards from the starter sets. The numbers are printed on the cards, not in the
// rulebook, so they start at common values and stay editable on the setup screen.
export const MISSIONS = ['Frontlines', 'Hold Position', 'Supply Drop', 'Gather the Resources', 'Divide and Conquer', 'Custom mission'];
export const DEPLOYMENTS = ['', 'Abandoned Camp', 'Agria Valley', 'Char Plains', 'Dirt Side', 'Frontier'];
export const PLAYER_COLORS = ['#4FB8FF', '#FF7A59', '#7BD88F'];

const newPlayer = (i) => ({ name: `Player ${i + 1}`, faction: FACTIONS[i % 3], roster: null, score: 0, supply: 0, units: [] });
const DEFAULTS = {
  started: false, finished: false, round: 1, phase: 0, first: 0, startedAt: 0, endedAt: 0,
  mission: 'Frontlines', deployment: '', startSupply: 3, escalation: 2, rounds: 5,
  players: [newPlayer(0), newPlayer(1)],
  log: [],
};
const box = saved('tmg.game', DEFAULTS);
export const game = box.state;
export const saveGame = box.save;

export function setPlayerCount(n) {
  const players = game.players.slice(0, n);
  while (players.length < n) players.push(newPlayer(players.length));
  game.players = players;
}

/** Supply Pool for a round: starting supply, plus the escalation each later round, unlimited in the last round. */
export function supplyPool(round = game.round) {
  if (round >= game.rounds) return Infinity;
  return game.startSupply + Math.max(0, round - 1) * game.escalation;
}
export const poolText = (p) => (p === Infinity ? '∞' : String(p));

/** Supply a player has on the table: from tracked units when they have any, else their manual counter. */
export function supplyOnTable(p) {
  if (!p.units.length) return p.supply;
  return p.units.filter((t) => t.status === 'field').reduce((n, t) => n + condition(t).supply, 0);
}

/**
 * Add a line to the game log. player: index of the player it is about (omit for game events).
 * With key and n, repeated taps merge into one line: text is then a function of the running total,
 * e.g. note((n) => `Marines took ${n} damage`, { player: 0, key: 'dmg:ab12', n: 1 }). A total of 0 removes the line.
 */
export function note(text, { player = null, key = null, n = 0 } = {}) {
  const last = game.log.at(-1);
  if (key && last && last.key === key && last.round === game.round && last.phase === game.phase) {
    last.n += n;
    if (last.n === 0) game.log.pop(); else Object.assign(last, { text: text(last.n), at: Date.now() });
  } else if (!key || n !== 0) {
    game.log.push({ round: game.round, phase: game.phase, player, key, n, text: key ? text(n) : text, at: Date.now() });
    if (game.log.length > 800) game.log.shift();
  }
  saveGame();
}

export function startGame() {
  for (const p of game.players) { p.score = 0; p.supply = 0; }
  Object.assign(game, { started: true, finished: false, round: 1, phase: 0, startedAt: Date.now(), endedAt: 0, log: [] });
  note(`Game started · ${game.mission} · ${game.players[game.first].name} has the First Player Marker`);
}

/** Move to the next phase, or the next round after Scoring & Cleanup. Returns 'phase' | 'round' | 'end'. */
export function advance() {
  if (game.phase < 3) { game.phase += 1; note(`${PHASES[game.phase]} Phase`); return 'phase'; }
  if (game.round >= game.rounds) { finishGame(); return 'end'; }
  game.round += 1;
  game.phase = 0;
  note(`Round ${game.round} begins · Supply Pool ${poolText(supplyPool())}`);
  return 'round';
}
export function stepBack() {
  if (game.phase > 0) game.phase -= 1;
  else if (game.round > 1) { game.round -= 1; game.phase = 3; } else return;
  note(`Stepped back to round ${game.round}, ${PHASES[game.phase]} Phase`);
}
export function finishGame() {
  Object.assign(game, { finished: true, endedAt: Date.now() });
  note('Game ended · ' + game.players.map((p) => `${p.name} ${p.score} VP`).join(', '));
}
/** Players with the top score: one winner, or several for a tie. */
export function leaders() {
  const top = Math.max(...game.players.map((p) => p.score));
  return game.players.filter((p) => p.score === top);
}
export function addScore(p, delta) {
  const before = p.score;
  p.score = clamp(p.score + delta, 0, 99);
  const i = game.players.indexOf(p);
  note((n) => `${n > 0 ? '+' : ''}${n} VP · now ${p.score}`, { player: i, key: 'vp:' + i, n: p.score - before });
}
/** Back to setup, keeping players, factions, lists and mission. */
export function newGame() {
  for (const p of game.players) { p.score = 0; p.supply = 0; p.units = []; }
  Object.assign(game, { started: false, finished: false, round: 1, phase: 0, first: 0, log: [] });
}
