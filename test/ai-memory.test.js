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
