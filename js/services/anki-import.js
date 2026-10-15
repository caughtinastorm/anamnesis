import { parseAnkiApkg } from '../../anki.js';
export async function importAnkiPackage(buffer) {
  if (typeof Worker === 'undefined') return parseAnkiApkg(buffer);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/anki-import.js', import.meta.url), { type: 'module' });
    const timeout = setTimeout(() => finish(new Error('Anki import timed out. Try a smaller package or text export.')), 60000);
    const finish = (error, cards) => {
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error); else resolve(cards);
    };
    worker.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data.cards);
    worker.onerror = () => finish(new Error('Unable to read the Anki package. Try a text export.'));
    worker.postMessage(buffer, [buffer]);
  });
}
