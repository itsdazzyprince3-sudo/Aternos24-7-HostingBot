'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AIMemory, MAX_MEMORY_NOTE_LENGTH, MAX_MEMORY_NOTES } = require('../lib/ai-memory');

function makeMemoryPath(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aternos-ai-memory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'data', 'memory.json');
}

test('AI memory creates its local file and reloads bounded notes', t => {
  const filePath = makeMemoryPath(t);
  const memory = new AIMemory(filePath);
  memory.addNote('Keep three logs when safe.');

  assert.deepEqual(new AIMemory(filePath).getNotes(), ['Keep three logs when safe.']);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).notes.length, 1);
});

test('AI memory retains only the newest bounded notes', t => {
  const memory = new AIMemory(makeMemoryPath(t));
  for (let index = 0; index < MAX_MEMORY_NOTES + 2; index += 1) {
    memory.addNote(`Note ${index}`);
  }

  assert.equal(memory.getNotes().length, MAX_MEMORY_NOTES);
  assert.equal(memory.getNotes()[0], 'Note 2');
  assert.throws(() => memory.addNote('x'.repeat(MAX_MEMORY_NOTE_LENGTH + 1)), /between 1 and/);
});

test('AI memory can use a smaller configured retention limit', t => {
  const memory = new AIMemory(makeMemoryPath(t), 3);
  for (let index = 0; index < 5; index += 1) memory.addNote(`Note ${index}`);
  assert.deepEqual(memory.getNotes(), ['Note 2', 'Note 3', 'Note 4']);
});

test('AI memory reports a corrupted local file instead of silently discarding it', t => {
  const filePath = makeMemoryPath(t);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{invalid');
  assert.throws(() => new AIMemory(filePath), /not valid JSON/);
});


test('structured memory upgrades notes-only files and persists bounded player and skill data', t => {
  const filePath = makeMemoryPath(t);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ notes: [{ note: 'Keep oak logs.', recordedAt: '2026-01-01T00:00:00.000Z' }] }));

  const memory = new AIMemory(filePath);
  assert.deepEqual(memory.getNotes(), ['Keep oak logs.']);
  memory.setFact('home', { x: 10, y: 64, z: -4 });
  memory.addWaypoint('home', { x: 10, y: 64, z: -4 });
  memory.addPlayerNote('Virgo', 'Prefers wood first.');
  memory.recordSkill('gatherWood', { success: true, durationMs: 1250, detail: '8 logs' });
  assert.equal(memory.removeNotesMatching('oak'), 1);

  const reloaded = new AIMemory(filePath);
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(reloaded.getFact('home'), { x: 10, y: 64, z: -4 });
  assert.equal(reloaded.getWaypoint('home').x, 10);
  assert.deepEqual(reloaded.getPlayerNotes('virgo'), ['Prefers wood first.']);
  assert.equal(reloaded.getSkill('gatherWood').successes, 1);
  assert.deepEqual(reloaded.getNotes(), []);
});
