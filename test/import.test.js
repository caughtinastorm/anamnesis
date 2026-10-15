import { test } from 'node:test';
import assert from 'node:assert/strict';
import initialize from 'sql.js';
import { zipSync } from 'fflate';
import { parseAnkiApkg } from '../anki.js';
const SQL = await initialize();
function packageOf(decks, models, notes, cards) {
  const database = new SQL.Database();
  database.run('CREATE TABLE col (decks TEXT, models TEXT); CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT); CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER)');
  database.run('INSERT INTO col VALUES (?,?)', [JSON.stringify(decks), JSON.stringify(models)]);
  for (const note of notes) database.run('INSERT INTO notes VALUES (?,?,?)', note);
  for (const card of cards) database.run('INSERT INTO cards VALUES (?,?,?,?)', card);
  const bytes = zipSync({ 'collection.anki2': database.export() }); database.close();
  return bytes.buffer;
}
const decks = { '10': { name: 'Japanese::Words' }, '20': { name: 'Science::Facts' } };
const basic = { type: 0, flds: [{ name: 'Front' }, { name: 'Back' }], tmpls: [
  { ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }, { ord: 1, qfmt: '{{Back}}', afmt: '{{Front}}' }
] };
await test('real SQLite import preserves non-ASCII notes, deck mapping and reverse templates', async () => {
  const input = packageOf(decks, { '1': basic }, [[100, 1, '猫\x1fcat'], [200, 1, 'Water\x1fH₂O']], [[1,100,10,0],[2,100,10,1],[3,200,20,0]]);
  const result = await parseAnkiApkg(input);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(card => card.front), ['猫', 'cat', 'Water']);
  assert.deepEqual(result.map(card => card.folder), ['Japanese', 'Japanese', 'Science']);
  assert.equal(result[2].back, 'H₂O');
});
await test('cloze SQLite import maps each ordinal to its target cloze', async () => {
  const input = packageOf(decks, { '2': { type: 1 } }, [[100,2,'{{c1::Paris}} is in {{c2::France}}.\x1fExtra']], [[1,100,10,0],[2,100,10,1]]);
  const result = await parseAnkiApkg(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].front, '[ ... ] is in France.');
  assert.equal(result[1].front, 'Paris is in [ ... ].');
});
await test('invalid and unsupported archives fail clearly rather than guessing card text', async () => {
  await assert.rejects(parseAnkiApkg(new Uint8Array([1,2,3]).buffer));
  await assert.rejects(parseAnkiApkg(zipSync({ 'collection.anki21b': new Uint8Array([1]) }).buffer), /newer Anki/);
});
