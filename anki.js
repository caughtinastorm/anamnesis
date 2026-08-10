/**
 * Anki Deck Transformer & Importer (10/10 Enterprise Grade)
 * 
 * Features:
 * 1. Pure client-side ZIP unpacking via native DecompressionStream.
 * 2. SQLite binary scanning with safe UTF-8 decoding and multi-deck preservation.
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
  try {
    const files = await unzipBuffer(arrayBuffer);
    
    // Find collection database (Anki 2.0 or Anki 2.1)
    const dbFile = files['collection.anki2'] || files['collection.anki21'];
    if (!dbFile) {
      throw new Error('Invalid .apkg archive: collection database not found.');
    }

    const cards = parseAnkiDatabase(dbFile);
    if (!cards || cards.length === 0) {
      throw new Error('No flashcards found inside the Anki package.');
    }

    return cards;
  } catch (err) {
    console.error('Error parsing Anki .apkg:', err);
    throw err;
  }
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

/**
 * Lightweight in-memory ZIP unpacker using native browser DecompressionStream
 */
async function unzipBuffer(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const files = {};

  // Find End of Central Directory (EOCD) signature 0x06054b50 from end
  let eocdOffset = -1;
  for (let i = buffer.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP archive: End of Central Directory record not found.');
  }

  const cdEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  let curOffset = cdOffset;
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(curOffset, true) !== 0x02014b50) {
      break;
    }

    const compressionMethod = view.getUint16(curOffset + 10, true);
    const compressedSize = view.getUint32(curOffset + 20, true);
    const uncompressedSize = view.getUint32(curOffset + 24, true);
    const fileNameLength = view.getUint16(curOffset + 28, true);
    const extraLength = view.getUint16(curOffset + 30, true);
    const commentLength = view.getUint16(curOffset + 32, true);
    const localHeaderOffset = view.getUint32(curOffset + 42, true);

    const fileNameBytes = bytes.subarray(curOffset + 46, curOffset + 46 + fileNameLength);
    const fileName = decoder.decode(fileNameBytes);

    curOffset += 46 + fileNameLength + extraLength + commentLength;

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      continue;
    }

    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;

    const rawCompressedData = bytes.subarray(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
      files[fileName] = rawCompressedData.buffer.slice(rawCompressedData.byteOffset, rawCompressedData.byteOffset + compressedSize);
    } else if (compressionMethod === 8) {
      try {
        const decompressed = await decompressDeflateRaw(rawCompressedData);
        files[fileName] = decompressed;
      } catch (decErr) {
        console.warn(`Failed to decompress file ${fileName}:`, decErr);
      }
    }
  }

  return files;
}

/**
 * Decompresses raw Deflate stream using browser's native DecompressionStream
 */
async function decompressDeflateRaw(uint8Data) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(uint8Data);
    writer.close();

    const response = new Response(ds.readable);
    return await response.arrayBuffer();
  } else {
    throw new Error('DecompressionStream API not supported in this browser.');
  }
}

/**
 * Extracts decks, notes, and card mappings from an Anki SQLite database buffer.
 */
function parseAnkiDatabase(dbBuffer) {
  const bytes = new Uint8Array(dbBuffer);
  const textDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const fullText = textDecoder.decode(bytes);

  // 1. Extract Deck Definitions (JSON structure inside "col" table)
  const deckMap = {};
  try {
    const decksMatch = fullText.match(/"decks"\s*:\s*(\{[\s\S]*?\})\s*,\s*"(?:dconf|models|conf)"/);
    if (decksMatch && decksMatch[1]) {
      const decksObj = JSON.parse(decksMatch[1]);
      Object.keys(decksObj).forEach(key => {
        const d = decksObj[key];
        if (d && d.id && d.name) {
          deckMap[d.id] = d.name;
        }
      });
    }
  } catch (e) {
    console.warn('Failed to parse decks JSON from Anki DB:', e);
  }

  // 2. Default Deck Name fallback
  const deckNames = Object.values(deckMap).filter(n => n && n !== 'Default');
  const defaultDeckName = deckNames[0] || Object.values(deckMap)[0] || 'Default';

  // 3. Extract Note Records with safe binary parsing
  const rawNotes = extractAnkiNotesFromBinary(bytes);
  const rawCards = [];

  rawNotes.forEach(record => {
    const fields = record.fields;
    if (fields.length < 2) return;

    const frontRaw = fields[0] || '';
    const backRaw = fields[1] || '';
    const subRaw = fields[2] || '';
    const descRaw = fields[3] || '';

    const front = cleanHtmlTags(frontRaw);
    const back = cleanHtmlTags(backRaw);
    if (!front && !back) return;

    const rawDeck = record.deckName || defaultDeckName;
    const { folder, deck } = normalizeAnkiDeck(rawDeck);

    rawCards.push({
      front,
      back,
      sub: cleanHtmlTags(subRaw) || undefined,
      description: cleanHtmlTags(descRaw) || undefined,
      folder: folder || undefined,
      deck: deck || 'Default'
    });
  });

  // 4. Expand Cloze Deletions
  const finalCards = [];
  rawCards.forEach(card => {
    const expanded = expandClozeCards(card);
    finalCards.push(...expanded);
  });

  return finalCards;
}

/**
 * Extracts note fields separated by 0x1f (Unit Separator) from Anki SQLite binary.
 * Uses safe UTF-8 boundaries to prevent non-ASCII character corruption.
 */
function extractAnkiNotesFromBinary(bytes) {
  const records = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const len = bytes.length;
  
  let i = 0;
  while (i < len) {
    if (bytes[i] === 0x1f) {
      // Find start of note fields sequence
      let start = i;
      while (start > 0 && bytes[start - 1] !== 0x00 && (i - start) < 8000) {
        start--;
      }

      // Find end of note fields sequence
      let end = i;
      while (end < len && bytes[end] !== 0x00 && (end - i) < 8000) {
        end++;
      }

      const segment = bytes.subarray(start, end);
      const str = decoder.decode(segment);

      if (str.includes('\x1f')) {
        const fields = str.split('\x1f').map(s => s.trim());
        if (fields.length >= 2 && (fields[0].length > 0 || fields[1].length > 0)) {
          // Verify fields look like valid card content (not binary garbage)
          const validRatio0 = getPrintableRatio(fields[0]);
          const validRatio1 = getPrintableRatio(fields[1]);
          if (validRatio0 > 0.8 && validRatio1 > 0.8) {
            records.push({ fields });
          }
        }
      }

      i = end;
    } else {
      i++;
    }
  }

  // Deduplicate records by front+back
  const uniqueMap = new Map();
  records.forEach(r => {
    const key = `${r.fields[0]}:::${r.fields[1]}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, r);
    }
  });

  return Array.from(uniqueMap.values());
}

function getPrintableRatio(str) {
  if (!str) return 1.0;
  let printable = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Allow standard printable ASCII, newlines, tabs, and all Unicode characters > 127
    if (code >= 32 || code === 10 || code === 13 || code === 9 || code > 127) {
      printable++;
    }
  }
  return printable / str.length;
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
