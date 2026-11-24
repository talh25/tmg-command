// Game screen: set up players and mission, then track rounds, phases, victory points, supply and units.
import { el, stepper, segmented, toast, confirmBox, pick, FACTIONS, FACTION_NAME, PHASES, PHASE_KEY } from '../lib.js';
import {
  game, saveGame, setPlayerCount, supplyPool, supplyOnTable, poolText, startGame, advance, stepBack, finishGame,
  leaders, addScore, newGame, MISSIONS, DEPLOYMENTS, PLAYER_COLORS,
} from '../game.js';
import { listRosters, rosterById, rosterTotals, rosterToUnits } from '../armies.js';
import { announce, say, mediaData } from '../audio.js';
import { openUnitSheet, unitSummary } from './tracker.js';

const select = (options, value, onChange, label) => el('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
  options.map(([v, text]) => el('option', { value: v, selected: v === value }, text)));
const field = (label, control) => el('label.field', el('span', label), control);

// ---------- setup ----------
function setupView(redraw) {
  const rosters = listRosters();
  const playerCard = (p, i) => {
    const mine = rosters.filter((r) => r.faction === p.faction);
    const r = rosterById(p.roster);
    const totals = r ? rosterTotals(r) : null;
    return el('section.card.player-setup', { style: { '--accent': PLAYER_COLORS[i] } },
      field('Name', el('input', { type: 'text', value: p.name, maxlength: 20, autocomplete: 'off',
        onchange: (e) => { p.name = e.target.value.trim() || `Player ${i + 1}`; saveGame(); } })),
      field('Faction', segmented(FACTIONS.map((f) => [f, FACTION_NAME[f]]), p.faction, (f) => { p.faction = f; p.roster = null; saveGame(); redraw(); })),
      field('Army list', select([['', 'No list'], ...mine.map((x) => [x.id, x.name])], p.roster || '', (v) => { p.roster = v || null; saveGame(); redraw(); }, 'Army list')),
      el('p.small.muted', totals ? `${r.units.length} units · ${totals.minerals} minerals · supply ${totals.supply}`
        : mine.length ? 'Pick a list to track its units during the game.' : ['No saved ', FACTION_NAME[p.faction], ' lists yet. ', el('a', { href: '#/armies' }, 'Build one')]));
  };
  const pools = Array.from({ length: game.rounds }, (_, i) => el('span' + (supplyPool(i + 1) === Infinity ? '.last' : ''), el('small', `R${i + 1}`), el('b', poolText(supplyPool(i + 1)))));
  return el('div.page',
    el('div.setup-grid',
      el('section.card',
        el('h2', 'Players'),
        segmented([[2, '2 players'], [3, '3 players']], game.players.length, (n) => { setPlayerCount(n); redraw(); })),
      game.players.map(playerCard),
      el('section.card',
        el('h2', 'Mission'),
        field('Mission card', select(MISSIONS.map((m) => [m, m]), game.mission, (v) => { game.mission = v; }, 'Mission')),
        field('Deployment card', select(DEPLOYMENTS.map((d) => [d, d || 'Not chosen']), game.deployment, (v) => { game.deployment = v; }, 'Deployment')),
        el('div.steppers',
          field('Starting supply', stepper(game.startSupply, { min: 0, max: 30, label: 'starting supply', onChange: (v) => { game.startSupply = v; redraw(); } })),
          field('Added per round', stepper(game.escalation, { min: 0, max: 10, label: 'supply per round', onChange: (v) => { game.escalation = v; redraw(); } })),
          field('Rounds', stepper(game.rounds, { min: 3, max: 10, label: 'rounds', onChange: (v) => { game.rounds = v; redraw(); } }))),
        el('div.pool-preview', { 'aria-label': 'Supply Pool per round' }, pools),
        el('p.small.muted', 'Copy these numbers from your Mission Card. The Supply Pool is unlimited in the last round.')),
      el('section.card',
        el('h2', 'First player'),
        segmented(game.players.map((p, i) => [i, p.name]), game.first, (i) => { game.first = i; }, 'wrap'),
        el('button.btn', { onclick: () => { game.first = Math.floor(Math.random() * game.players.length); toast(`${game.players[game.first].name} goes first`); redraw(); } }, 'Roll off'))),
    el('div.cta', el('button.btn.primary.big', { onclick: () => { begin(); redraw(); } }, 'Start game')));
}

function begin() {
  for (const p of game.players) p.units = rosterToUnits(rosterById(p.roster));
  startGame();
  const m = mediaData();
  if (m) announce(pick(m.intro.faction[game.players[game.first].faction] || []), pick(m.intro.glhf), m.announcer.round['1'], m.announcer.phase.movement);
}

// ---------- play ----------
function clock() {
  const s = Math.floor(((game.endedAt || Date.now()) - game.startedAt) / 1000);
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${mm}:${String(s % 60).padStart(2, '0')}`;
}

function playerCard(p, i, redraw) {
  const pool = supplyPool();
  const used = supplyOnTable(p);
  const tracked = p.units.length > 0;
  return el('section.card.player' + (used > pool ? '.over' : ''), { style: { '--accent': PLAYER_COLORS[i] } },
    el('div.player-head',
      el('div', el('h2', p.name), el('small.muted', FACTION_NAME[p.faction])),
      el('button.badge' + (game.first === i ? '.on' : ''), { 'aria-pressed': String(game.first === i), title: 'First Player Marker',
        onclick: () => { game.first = i; redraw(); } }, game.first === i ? '★ First player' : '☆ First')),
    el('div.counters',
      el('div.counter', el('small', 'Victory points'), stepper(p.score, { min: 0, max: 99, big: true, label: `${p.name} victory points`, onChange: (v) => { addScore(p, v - p.score); } })),
      el('div.counter', el('small', `Supply on table · pool ${poolText(pool)}`),
        tracked ? el('div.supply-read' + (used > pool ? '.over' : ''), el('b', String(used)), el('small', 'from units'))
          : stepper(p.supply, { min: 0, max: 99, big: true, label: `${p.name} supply`, onChange: (v) => { p.supply = v; saveGame(); redraw(); } }))),
    el('button.btn.wide', { onclick: () => openUnitSheet(p, redraw) }, tracked ? `Units · ${unitSummary(p)}` : 'Track units'));
}

function playView(redraw) {
  const pool = supplyPool();
  const last = game.round >= game.rounds && game.phase === 3;
  const next = () => {
    const what = advance();
    const m = mediaData()?.announcer;
    if (what === 'end') return end(redraw);
    if (what === 'round') {
      announce(m?.round[String(game.round)], m?.phase.movement);
      toast(`Round ${game.round} · Supply Pool ${poolText(supplyPool())}`);
    } else announce(m?.phase[PHASE_KEY[game.phase]]);
    redraw();
  };
  return el('div.page',
    el('section.card.round-card',
      el('div.round-top',
        el('div', el('small.eyebrow', game.mission + (game.deployment ? ` · ${game.deployment}` : '')), el('h2', `Round ${game.round} of ${game.rounds}`)),
        el('div.pool', el('small', 'Supply Pool'), el('b', poolText(pool)), pool === Infinity ? el('small', 'last round') : null),
        el('div.pool', el('small', 'Time'), el('b.clock', clock()))),
      el('ol.phases', PHASES.map((name, i) => el('li' + (i === game.phase ? '.now' : i < game.phase ? '.done' : ''), { 'aria-current': i === game.phase ? 'step' : null }, el('span', String(i + 1)), name))),
      el('div.round-actions',
        el('button.btn', { disabled: game.round === 1 && game.phase === 0, onclick: () => { stepBack(); redraw(); } }, 'Back'),
        el('button.btn.primary.big', { onclick: next }, last ? 'Finish game' : game.phase === 3 ? `Start round ${game.round + 1}` : `Next: ${PHASES[game.phase + 1]}`))),
    el('div.players', game.players.map((p, i) => playerCard(p, i, redraw))),
    el('div.row.end',
      el('button.btn', { onclick: async () => { if (await confirmBox('End the game now?', 'The current scores decide the result.', 'End game')) { finishGame(); end(redraw); } } }, 'End game'),
      el('button.btn.danger', { onclick: async () => { if (await confirmBox('Abandon this game?', 'Scores and tracked units are cleared. Players and mission are kept.', 'Abandon')) { newGame(); redraw(); } } }, 'Abandon')));
}

function end(redraw) {
  const top = leaders();
  const m = mediaData();
  if (m) {
    if (top.length > 1) say(pick(m.results.tie));
    else say(m.announcer.victory[top[0].faction], pick(m.results.win[top[0].faction].length ? m.results.win[top[0].faction] : m.results.neutral));
  }
  redraw();
}

function resultView(redraw) {
  const top = leaders();
  const tie = top.length > 1;
  const ranked = [...game.players].sort((a, b) => b.score - a.score);
  return el('div.page',
    el('section.card.result', { style: { '--accent': tie ? 'var(--line)' : `var(--${top[0].faction})` } },
      el('small.eyebrow', `${game.mission} · ${game.round} rounds · ${clock()}`),
      el('h2', tie ? 'Draw' : `${top[0].name} wins`),
      el('p.muted', tie ? `${top.map((p) => p.name).join(' and ')} are level on ${top[0].score} VP.` : `${FACTION_NAME[top[0].faction]} victory with ${top[0].score} VP.`),
      el('div.list', ranked.map((p) => el('div.list-row', el('div', el('b', p.name), ' ', el('small.muted', FACTION_NAME[p.faction])), el('b', `${p.score} VP`)))),
      el('div.actions',
        el('button.btn', { onclick: () => { Object.assign(game, { finished: false }); redraw(); } }, 'Back to the game'),
        el('button.btn.primary', { onclick: () => { newGame(); redraw(); } }, 'New game'))));
}

export function render() {
  const node = el('div');
  const redraw = () => node.replaceChildren(!game.started ? setupView(redraw) : game.finished ? resultView(redraw) : playView(redraw));
  redraw();
  const timer = setInterval(() => { const c = node.querySelector('.clock'); if (c && !game.finished) c.textContent = clock(); }, 1000);
  return { title: 'Game', node, cleanup: () => clearInterval(timer) };
}
