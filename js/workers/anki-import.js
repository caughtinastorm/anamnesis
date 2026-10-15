import { parseAnkiApkg } from '../../anki.js';
self.onmessage = async event => {
  try { self.postMessage({ cards: await parseAnkiApkg(event.data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
