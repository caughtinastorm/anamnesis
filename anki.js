
/**
 * Anki text and package importer
 * 
 * Features:
 * 1. Client-side ZIP extraction with declared-size limits.
 * 2. SQLite queries with note, card and deck mapping.
 * 3. Authentic Cloze Expansion: generates individual cards for {{c1::...}}, {{c2::...}}, etc.
 * 4. HTML entity decoding & sanitization (handles &nbsp;, <br>, <div>, [sound:...], hints).
 * 5. Flexible Anki text/TSV parsing (#separator:, #deck:, etc.).
 */

/**
 * Parses an Anki .apkg ArrayBuffer into native anamnesis card objects.
 * @param {ArrayBuffer} arrayBuffer Raw bytes of the .apkg file
 * @returns {Promise<Array<Object>>} List of parsed flashcard objects
 */
export async function parseAnkiApkg(arrayBuffer) {
  if (arrayBuffer.byteLength > 100 * 1024 * 1024) throw new Error('Anki package exceeds the 100 MB limit.');
  const { unzipSync } = await import('./vendor/fflate.js');
  const files = unzipSync(new Uint8Array(arrayBuffer), {
    filter: file => {
      if (!['collection.anki2', 'collection.anki21', 'collection.anki21b'].includes(file.name)) return false;
      if (file.originalSize > 100 * 1024 * 1024) throw new Error('Anki database exceeds the 100 MB limit.');
      return true;
    }
  });
  if (files['collection.anki21b']) throw new Error('This newer Anki package format is not supported. Export with “Support older Anki versions”, or use a text export.');
  const data = files['collection.anki21'] || files['collection.anki2'];
  if (!data) throw new Error('Anki package has no collection database.');
  let SQL;
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { default: initialize } = await import('sql.js');
    SQL = await initialize();
  } else {
    const { default: initialize } = await import('./vendor/sql-wasm-browser.js');
    SQL = await initialize({ locateFile: file => new URL(`./vendor/${file}`, import.meta.url).href });
  }
  return parseAnkiDatabase(data, SQL);
}

/**
 * Parses Anki exported text or TSV string into native anamnesis card objects.
 * @param {string} text Anki text/tsv content
 * @returns {Array<Object>} List of parsed flashcard objects
 */
export function parseAnkiText(text) {
  const lines = text.split(/\r?\n/);
  const rawCards = [];
  
  let currentDeck = 'Default';
  let separator = '\t';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for Anki header directives
    if (line.startsWith('#')) {
      const lower = line.toLowerCase();
      if (lower.startsWith('#separator:')) {
        const sepValue = line.substring(11).trim().toLowerCase();
        if (sepValue === 'tab' || sepValue === '\t') separator = '\t';
        else if (sepValue === 'comma' || sepValue === ',') separator = ',';
        else if (sepValue === 'semicolon' || sepValue === ';') separator = ';';
        else if (sepValue === 'pipe' || sepValue === '|') separator = '|';
        else if (sepValue.length === 1) separator = sepValue;
      } else if (lower.startsWith('#deck:')) {
        currentDeck = line.substring(6).trim();
      }
      continue;
    }

    // Split fields by separator
    const fields = splitFields(line, separator).map(cleanField);
    if (fields.length < 2) continue;

    const rawFront = fields[0] || '';
    const rawBack = fields[1] || '';
    const rawSub = fields[2] || '';
    const customDeck = fields[3] || currentDeck;
    const rawDesc = fields[4] || '';

    const { folder, deck } = normalizeAnkiDeck(customDeck);

    let front = cleanHtmlTags(rawFront);
    let sub = cleanHtmlTags(rawSub);
    if (front.includes('|') && !front.includes('{{c')) {
      const parts = front.split('|');
      front = parts[0].trim();
      if (!sub) sub = parts[1].trim();
    }

    rawCards.push({
      front,
      back: cleanHtmlTags(rawBack),
      sub: sub || undefined,
      description: cleanHtmlTags(rawDesc) || undefined,
      folder: folder || undefined,
      deck: deck || 'Default'
    });
  }

  // Expand Cloze Cards
  const finalCards = [];
  rawCards.forEach(card => {
    const expanded = expandClozeCards(card);
    finalCards.push(...expanded);
  });

  return finalCards;
}

/**
 * Extracts folder and deck from Anki hierarchical deck names (e.g. "Spanish::Verbs" -> folder: "Spanish", deck: "Verbs")
 */
export function normalizeAnkiDeck(deckName) {
  if (!deckName) return { folder: undefined, deck: 'Default' };
  
  if (deckName.includes('::')) {
    const parts = deckName.split('::').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return {
        folder: parts[0],
        deck: parts.slice(1).join(' / ')
      };
    }
    return { folder: undefined, deck: parts[0] };
  }

  if (deckName.includes(' / ')) {
    const parts = deckName.split(' / ').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return {
        folder: parts[0],
        deck: parts.slice(1).join(' / ')
      };
    }
    return { folder: undefined, deck: parts[0] };
  }

  return { folder: undefined, deck: deckName.trim() };
}

/**
 * Expands a note containing Anki Cloze deletions ({{c1::...}}, {{c2::...}}) into individual flashcards.
 * @param {Object} card Raw card object
 * @returns {Array<Object>} One or more card objects
 */
export function expandClozeCards(card) {
  const clozeRegex = /\{\{c(\d+)::(.*?)\}\}/gi;
  const matches = [...card.front.matchAll(clozeRegex)];

  if (matches.length === 0) {
    return [card];
  }

  // Extract all unique cloze indices
  const indices = new Set();
  matches.forEach(m => indices.add(parseInt(m[1], 10)));
  const sortedIndices = Array.from(indices).sort((a, b) => a - b);

  if (sortedIndices.length === 0) {
    return [card];
  }

  const generatedCards = [];

  sortedIndices.forEach(targetIdx => {
    // Generate Front: replace target cloze with blank [ ... ] or [ hint ], reveal others as plain text
    const frontText = card.front.replace(/\{\{c(\d+)::(.*?)\}\}/gi, (match, idxStr, content) => {
      const idx = parseInt(idxStr, 10);
      const parts = content.split('::');
      const answer = parts[0];
      const hint = parts[1];

      if (idx === targetIdx) {
        return hint ? `[ ${hint} ]` : `[ ... ]`;
      } else {
        return answer;
      }
    });

    // Generate Back: show target cloze answer, reveal others as plain text
    const backText = card.front.replace(/\{\{c(\d+)::(.*?)\}\}/gi, (match, idxStr, content) => {
      const idx = parseInt(idxStr, 10);
      const parts = content.split('::');
      const answer = parts[0];

      if (idx === targetIdx) {
        return `[ ${answer} ]`;
      } else {
        return answer;
      }
    });

    // Combine with existing back content if present
    const combinedBack = card.back ? `${backText}<br><br>${card.back}` : backText;

    generatedCards.push({
      ...card,
      front: frontText.trim(),
      back: combinedBack.trim(),
      sub: card.sub ? `${card.sub} (c${targetIdx})` : undefined
    });
  });

  return generatedCards;
}

/** Read real SQLite records. Imported cards begin with fresh FSRS schedules. */
function parseAnkiDatabase(bytes, SQL) {
  const database = new SQL.Database(bytes);
  try {
    const collection = database.exec('SELECT decks, models FROM col LIMIT 1')[0];
    if (!collection?.values.length) throw new Error('Anki database is missing collection metadata.');
    const [decksJSON, modelsJSON] = collection.values[0];
    const decks = JSON.parse(decksJSON), models = JSON.parse(modelsJSON);
    const records = database.exec('SELECT notes.id, notes.mid, notes.flds, cards.did, cards.ord FROM notes JOIN cards ON cards.nid = notes.id ORDER BY cards.id')[0];
    if (!records?.values.length) throw new Error('No cards found in the Anki package.');
    const result = [];
    for (const [, modelId, rawFields, deckId, ordinal] of records.values) {
      const model = models[String(modelId)];
      const rawDeck = decks[String(deckId)]?.name;
      if (!model || !rawDeck) throw new Error('Unsupported Anki metadata. Export with older-version compatibility or use text export.');
      const fields = String(rawFields).split('\x1f');
      const { folder, deck } = normalizeAnkiDeck(rawDeck);
      if (model.type === 1) {
        const source = { front: cleanHtmlTags(fields[0] || ''), back: cleanHtmlTags(fields[1] || ''), folder, deck };
        const expanded = expandClozeCards(source);
        const indices = [...new Set([...source.front.matchAll(/\{\{c(\d+)::/gi)].map(match => Number(match[1])))].sort((a,b) => a-b);
        const selected = expanded[indices.indexOf(Number(ordinal) + 1)];
        if (selected) result.push(selected);
      } else {
        const template = model.tmpls?.find(item => Number(item.ord) === Number(ordinal));
        if (!template) throw new Error('Anki card template is missing.');
        const values = Object.fromEntries((model.flds || []).map((field, index) => [field.name, fields[index] || '']));
        const render = (text, frontSide = '') => {
          let output = String(text || '').replace(/\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g,
            (_all, kind, name, content) => ((kind === '#') === Boolean(values[name]?.trim())) ? content : '');
          output = output.replace(/\{\{FrontSide\}\}/g, frontSide)
            .replace(/\{\{(?:[^}:]+:)*([^}]+)\}\}/g, (_match, name) => values[name] || '');
          return cleanHtmlTags(output);
        };
        const front = render(template.qfmt);
        const back = render(template.afmt, front);
        if (!front && !back) continue;
        result.push({ front, back, folder, deck });
      }
    }
    if (!result.length) throw new Error('No supported cards found in this package.');
    return result;
  } finally { database.close(); }
}

/**
 * Splits line by delimiter respecting double quotes
 */
function splitFields(line, sep) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === sep && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function cleanField(field) {
  let cleaned = field.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  return cleaned.replace(/""/g, '"');
}

/**
 * Sanitizes and cleans rich HTML tags commonly generated by Anki (e.g. <div>, <br>, [sound:...], HTML entities)
 */
export function cleanHtmlTags(html) {
  if (!html) return '';

  return html
    // 1. Remove Anki audio references like [sound:pronunciation.mp3]
    .replace(/\[sound:[^\]]+\]/gi, '')
    // 2. Remove <script> and <style> blocks
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // 3. Replace <br>, <div>, <p> with linebreaks
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/<\/(div|p|li)>/gi, '<br>')
    .replace(/<(div|p|li)[^>]*>/gi, '')
    // 4. Decode HTML Entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#039;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    // 5. Remove style/class attributes from allowed inline formatting
    .replace(/\sstyle="[^"]*"/gi, '')
    .replace(/\sclass="[^"]*"/gi, '')
    // 6. Clean consecutive and leading/trailing <br>
    .replace(/(<br>\s*){3,}/gi, '<br><br>')
    .replace(/^(<br\s*\/?>)+|(<br\s*\/?>)+$/gi, '')
    .trim();
}
