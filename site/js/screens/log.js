// Game log: everything that happened in the game, newest first, grouped by round and phase.
import { el, dialog, toast, segmented, PHASES } from '../lib.js';
import { game, note, PLAYER_COLORS } from '../game.js';

const time = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const who = (e) => (e.player == null ? null : game.players[e.player]?.name || `Player ${e.player + 1}`);

/** The log as plain text, oldest first, for copying or sharing. */
export function logText() {
  const out = [];
  let head = '';
  for (const e of game.log) {
    const h = `Round ${e.round} · ${PHASES[e.phase]}`;
    if (h !== head) { out.push('', h); head = h; }
    out.push(`${time(e.at)}  ${who(e) ? who(e) + ': ' : ''}${e.text}`);
  }
  return out.join('\n').trim();
}

export function logRow(e) {
  return el('div.log-row' + (e.player == null ? '.event' : ''), { style: e.player == null ? null : { '--accent': PLAYER_COLORS[e.player] } },
    el('small.muted', time(e.at)),
    el('span', who(e) ? [el('b', who(e)), ' · '] : null, e.text));
}

export function openLog() {
  let filter = 'all';
  const list = el('div.log-list');
  const draw = () => {
    const shown = game.log.filter((e) => filter === 'all' || e.player === filter || e.player == null).reverse();
    const kids = [];
    let head = '';
    for (const e of shown) {
      const h = `Round ${e.round} · ${PHASES[e.phase]}`;
      if (h !== head) { kids.push(el('h4.log-head', h)); head = h; }
      kids.push(logRow(e));
    }
    list.replaceChildren(...(kids.length ? kids : [el('p.muted.center', 'Nothing has happened yet.')]));
  };
  const input = el('input', { type: 'text', maxlength: 140, placeholder: 'Add a note, e.g. "Objective B changed hands"', 'aria-label': 'Note', autocomplete: 'off' });
  const addNote = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    note('Note: ' + text, { player: filter === 'all' ? null : filter });
    input.value = '';
    draw();
  };
  const share = async () => {
    const text = logText();
    try {
      if (navigator.share) await navigator.share({ title: 'TMG Command game log', text });
      else { await navigator.clipboard.writeText(text); toast('Game log copied'); }
    } catch (err) { if (err?.name !== 'AbortError') toast('Could not copy the log'); }
  };
  draw();
  dialog((close) => el('div.unit-sheet',
    el('div.sheet-head', el('div', el('h3', 'Game log'), el('small.muted', `${game.log.length} entries · newest first`))),
    segmented([['all', 'Everything'], ...game.players.map((p, i) => [i, p.name])], filter, (f) => { filter = f; draw(); }, 'small'),
    list,
    el('form.log-add', { onsubmit: addNote }, input, el('button.btn', { type: 'submit' }, 'Add')),
    el('div.actions',
      el('button.btn', { disabled: !game.log.length, onclick: share }, navigator.share ? 'Share' : 'Copy'),
      el('button.btn.primary', { onclick: close }, 'Done'))), { sheet: true });
}
