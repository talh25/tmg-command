// Armies: the Army Builder page, shown in a same-origin frame. It saves lists to the storage this app reads.
import { el } from '../lib.js';

export function render([faction]) {
  const frame = el('iframe.builder', { src: 'army/index.html', title: 'Army Builder' });
  if (/^(terran|zerg|protoss)$/.test(faction || '')) {
    frame.addEventListener('load', () => frame.contentWindow.postMessage({ type: 'army:faction', faction }, location.origin));
  }
  return { title: 'Army lists', node: frame, cls: 'flush' };
}
