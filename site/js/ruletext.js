// Rulebook data and "rich" rules text: glossary keywords and section numbers in any text become links.
import { el, loadJson, dialog } from './lib.js';

let rules = null;
let terms = new Map();     // 'ANTI-EVADE' -> glossary entry
let sections = new Map();  // '8.7.4' -> section
let pattern = null;

const baseTerm = (term) => term.replace(/\s*\(.*?\)\s*$/, '').trim().toUpperCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function loadRules() {
  if (rules) return rules;
  rules = await loadJson('data/rules.json');
  sections = new Map(rules.sections.map((s) => [s.id, s]));
  terms = new Map(rules.glossary.map((g) => [baseTerm(g.term), g]));
  // Longest first, so "WHOLLY WITHIN" wins over "WITHIN". Only ALL-CAPS uses are linked: the books write
  // keywords in capitals, and linking every plain "Unit" or "Move" would bury the text in links.
  const words = [...terms.keys()].filter((t) => t.length > 2).sort((a, b) => b.length - a.length).map(escapeRe);
  pattern = new RegExp(`(?<![A-Za-z-])(${words.join('|')})(?![A-Za-z])|\\b(?:(Part|Section)\\s+)?(\\d{1,2}(?:\\.\\d{1,2}){1,2})(?![\\d"”″.]|\\s*(?:inch|mm|cm))|\\bPart\\s+(\\d{1,2})\\b`, 'g');
  return rules;
}
export const rulesData = () => rules;
export const sectionById = (id) => sections.get(id) || null;
export const termEntry = (name) => terms.get(baseTerm(name)) || null;

/** Show a glossary entry in a small dialog. */
export function showTerm(name) {
  const g = termEntry(name);
  if (!g) return;
  dialog((close) => [
    el('small.eyebrow', 'Glossary'), el('h3', g.term),
    el('p', rich(g.text, { skip: baseTerm(g.term) })),
    g.ref ? el('p.muted.small', g.ref) : null,
    el('div.actions',
      el('a.btn', { href: '#/rules/glossary/' + encodeURIComponent(baseTerm(g.term)), onclick: close }, 'Open in glossary'),
      el('button.btn.primary', { onclick: close }, 'Close')),
  ]);
}

/** Text -> nodes, with keywords opening their glossary entry and section numbers linking into the rulebook. */
export function rich(text, { skip = '' } = {}) {
  if (!pattern || !text) return [text || ''];
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(pattern)) {
    let node = null;
    if (m[1]) {
      if (m[1] !== skip) node = el('button.term', { type: 'button', onclick: () => showTerm(m[1]) }, m[1]);
    } else if (m[3] && sections.has(m[3])) node = el('a.ref', { href: '#/rules/' + m[3] }, m[0]);
    else if (m[4] && sections.has(m[4])) node = el('a.ref', { href: '#/rules/' + m[4] }, m[0]);
    if (!node) continue;
    out.push(text.slice(last, m.index), node);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** A keyword chip (weapon keywords, tags) that opens the glossary when the term is known. */
export function keywordChip(word) {
  return termEntry(word)
    ? el('button.chip.link', { type: 'button', onclick: () => showTerm(word) }, word)
    : el('span.chip', word);
}
