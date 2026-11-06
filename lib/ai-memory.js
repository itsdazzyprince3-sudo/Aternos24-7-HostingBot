'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_MEMORY_NOTES = 100;
const MAX_MEMORY_NOTE_LENGTH = 300;
const DEFAULT_MEMORY_PATH = path.resolve(__dirname, '..', 'data', 'ai-memory.json');

class AIMemory {
  constructor(filePath = DEFAULT_MEMORY_PATH, maxNotes = MAX_MEMORY_NOTES) {
    if (!Number.isInteger(maxNotes) || maxNotes < 1 || maxNotes > 500) {
      throw new Error('AI memory limit must be an integer from 1 to 500 notes.');
    }
    this.filePath = filePath;
    this.maxNotes = maxNotes;
    this.notes = this.read();
  }

  getNotes() {
    return this.notes.map(entry => entry.note);
  }

  addNote(value) {
    if (typeof value !== 'string') throw new TypeError('AI memory notes must be text.');
    const note = value.trim();
    if (!note || note.length > MAX_MEMORY_NOTE_LENGTH) {
      throw new Error(`AI memory notes must be between 1 and ${MAX_MEMORY_NOTE_LENGTH} characters.`);
    }

    this.notes = [...this.notes, { note, recordedAt: new Date().toISOString() }].slice(-this.maxNotes);
    this.write();
    return note;
  }

  read() {
    let content;
    try {
      content = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error(`Could not read local AI memory: ${error.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Local AI memory is not valid JSON: ${error.message}`);
    }
    if (!parsed || !Array.isArray(parsed.notes)) {
      throw new Error('Local AI memory must contain a notes array.');
    }
    return parsed.notes.map(entry => {
      if (!entry || typeof entry.note !== 'string' || typeof entry.recordedAt !== 'string') {
        throw new Error('Local AI memory contains an invalid note entry.');
      }
      return {
        note: entry.note.slice(0, MAX_MEMORY_NOTE_LENGTH),
        recordedAt: entry.recordedAt
      };
    }).slice(-this.maxNotes);
  }

  write() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ notes: this.notes }, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    fs.renameSync(temporaryPath, this.filePath);
  }
}

module.exports = {
  AIMemory,
  MAX_MEMORY_NOTE_LENGTH,
  MAX_MEMORY_NOTES
};
