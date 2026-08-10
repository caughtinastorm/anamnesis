/**
 * Anki Deck Transformer & Importer
 * 
 * Provides pure client-side parsing for:
 * 1. Anki .apkg packages (ZIP unpacking + SQLite extraction using native browser APIs)
 * 2. Anki exported text / TSV files (#separator:tab, #deck:..., etc.)
 */

/**
 * Parses an Anki .apkg ArrayBuffer into native anamnesis card objects.
 * @param {ArrayBuffer} arrayBuffer Raw bytes of the .apkg file
 * @returns {Promise<Array<Object>>} List of parsed flashcard objects
 */
export async function parseAnkiApkg(arrayBuffer) {
  try {
    const files = await unzipBuffer(arrayBuffer);
    
    // Find collection.anki2 (SQLite 3 DB) or collection.anki21
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
  const cards = [];
  
  let currentDeck = 'Default';
  let separator = '\t';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for Anki header directives
    if (line.startsWith('#')) {
      const lower = line.toLowerCase();
      if (lower.startsWith('#separator:')) {
        const sepValue = line.substring(11).trim();
        if (sepValue.toLowerCase() === 'tab' || sepValue === '\t') separator = '\t';
        else if (sepValue.toLowerCase() === 'comma' || sepValue === ',') separator = ',';
        else if (sepValue.toLowerCase() === 'semicolon' || sepValue === ';') separator = ';';
        else if (sepValue.toLowerCase() === 'pipe' || sepValue === '|') separator = '|';
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

    // Parse subtext if front has "Front|Subtext" format
    let front = cleanHtmlTags(rawFront);
    let sub = cleanHtmlTags(rawSub);
    if (front.includes('|')) {
      const parts = front.split('|');
      front = parts[0].trim();
      if (!sub) sub = parts[1].trim();
    }

    cards.push({
      front,
      back: cleanHtmlTags(rawBack),
      sub: sub || undefined,
      description: cleanHtmlTags(rawDesc) || undefined,
      folder: folder || undefined,
      deck: deck || 'Default'
    });
  }

  return cards;
}

/**
 * Extracts folder and deck from Anki hierarchical deck names (e.g. "Spanish::Verbs" -> folder: "Spanish", deck: "Verbs")
 */
export function normalizeAnkiDeck(deckName) {
  if (!deckName) return { folder: undefined, deck: 'Default' };
  
  // Handle Anki "::" delimiter or slash "/" delimiter
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

    // Read Local File Header to locate file data
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      continue;
    }

    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;

    const rawCompressedData = bytes.subarray(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
      // Stored (no compression)
      files[fileName] = rawCompressedData.buffer.slice(rawCompressedData.byteOffset, rawCompressedData.byteOffset + compressedSize);
    } else if (compressionMethod === 8) {
      // Deflate compression
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
  const textDecoder = new TextDecoder('utf-8');
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

  // 2. Extract Card nid -> did mapping
  // In Anki cards table: id (0), nid (1), did (2)
  const nidToDeckName = {};
  
  // Find all decks names available
  const defaultDeckName = Object.values(deckMap)[0] || 'Default';

  // 3. Extract Notes by finding unit-separator (\x1f) delimited text records
  const cards = [];
  const noteRecords = extractAnkiNotesFromBinary(bytes);

  noteRecords.forEach(record => {
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

    cards.push({
      front,
      back,
      sub: cleanHtmlTags(subRaw) || undefined,
      description: cleanHtmlTags(descRaw) || undefined,
      folder: folder || undefined,
      deck: deck || 'Default'
    });
  });

  return cards;
}

/**
 * Extracts note fields separated by 0x1f (Unit Separator) from Anki SQLite binary.
 */
function extractAnkiNotesFromBinary(bytes) {
  const records = [];
  const decoder = new TextDecoder('utf-8');
  const len = bytes.length;
  
  let i = 0;
  while (i < len) {
    // Look for 0x1f (field delimiter in Anki notes)
    if (bytes[i] === 0x1f) {
      // Find beginning of note fields sequence
      let start = i;
      while (start > 0 && bytes[start - 1] >= 0x20 && (i - start) < 4000) {
        start--;
      }

      // Find end of note fields sequence
      let end = i;
      while (end < len && (bytes[end] >= 0x20 || bytes[end] === 0x1f || bytes[end] === 0x0a || bytes[end] === 0x0d) && (end - i) < 4000) {
        end++;
      }

      const segment = bytes.subarray(start, end);
      const str = decoder.decode(segment);

      if (str.includes('\x1f')) {
        const fields = str.split('\x1f').map(s => s.trim());
        if (fields.length >= 2 && fields[0].length > 0 && fields[1].length > 0) {
          records.push({ fields });
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
 * Sanitizes and cleans rich HTML tags commonly generated by Anki (e.g. <div>, <br>, [sound:...])
 */
function cleanHtmlTags(html) {
  if (!html) return '';

  return html
    // Remove Anki audio references like [sound:pronunciation.mp3]
    .replace(/\[sound:[^\]]+\]/gi, '')
    // Replace <br>, <div>, <p> with linebreaks or clean tags
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/<\/(div|p)>/gi, '<br>')
    .replace(/<(div|p)[^>]*>/gi, '')
    // Remove style attributes
    .replace(/\sstyle="[^"]*"/gi, '')
    .replace(/\sclass="[^"]*"/gi, '')
    // Clean trailing/leading <br>
    .replace(/^(<br>)+|(<br>)+$/gi, '')
    .trim();
}
