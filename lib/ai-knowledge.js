'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_KNOWLEDGE_PATH = path.resolve(__dirname, '..', 'data', 'ai-knowledge.json');
const MAX_ENTRIES = 2000;
const MAX_EXPERIENCES = 300;
const MAX_SUMMARY_LENGTH = 600;
const MAX_FACTS_PER_ENTRY = 6;
const MAX_QUEUE = 30;
const MAX_TOPIC_LENGTH = 120;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TOPIC_LENGTH) || 'untitled';
}

function tokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(token => token.length > 2);
}

function clampText(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

class AIKnowledge {
  constructor(filePath = DEFAULT_KNOWLEDGE_PATH, { maxEntries = MAX_ENTRIES } = {}) {
    this.filePath = filePath;
    this.maxEntries = Math.max(50, Math.min(5000, Number(maxEntries) || MAX_ENTRIES));
    this.entries = [];
    this.queue = [];
    this.training = {};
    this.read();
  }

  read() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      this.queue = Array.isArray(parsed?.queue) ? parsed.queue : [];
      this.training = parsed?.training && typeof parsed.training === 'object' ? parsed.training : {};
    } catch {
      this.entries = [];
      this.queue = [];
      this.training = {};
    }
  }

  write() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        training: this.training,
        queue: this.queue,
        entries: this.entries
      }, null, 2)}\n`);
      fs.renameSync(temporary, this.filePath);
    } catch {
      // A full disk must not take the bot down; the in-memory knowledge stays usable.
    }
  }

  get(topic) {
    const id = slugify(topic);
    return this.entries.find(entry => entry.id === id) || null;
  }

  upsert({ topic, title, summary, facts = [], source = '', url = '', kind = 'knowledge' }) {
    const normalizedTopic = clampText(topic, MAX_TOPIC_LENGTH);
    if (!normalizedTopic) throw new Error('Knowledge topics must be non-empty text.');
    const id = slugify(normalizedTopic);
    const existing = this.entries.find(entry => entry.id === id);
    const now = new Date().toISOString();
    const entry = {
      id,
      topic: normalizedTopic,
      title: clampText(title || normalizedTopic, 160),
      summary: clampText(summary, MAX_SUMMARY_LENGTH),
      facts: (Array.isArray(facts) ? facts : []).map(fact => clampText(fact, 320)).filter(Boolean).slice(0, MAX_FACTS_PER_ENTRY),
      source: clampText(source, 300),
      url: clampText(url, 500),
      kind: kind === 'experience' ? 'experience' : 'knowledge',
      learnedAt: existing?.learnedAt || now,
      updatedAt: now,
      hits: existing?.hits || 0,
      lastUsedAt: existing?.lastUsedAt || null
    };
    this.entries = this.entries.filter(item => item.id !== id);
    this.entries.push(entry);
    this.trim();
    this.write();
    return entry;
  }

  trim() {
    const experiences = this.entries.filter(entry => entry.kind === 'experience');
    if (experiences.length > MAX_EXPERIENCES) {
      const stale = new Set(experiences
        .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
        .slice(0, experiences.length - MAX_EXPERIENCES)
        .map(entry => entry.id));
      this.entries = this.entries.filter(entry => !stale.has(entry.id));
    }
    if (this.entries.length > this.maxEntries) {
      const removable = this.entries
        .filter(entry => entry.kind !== 'knowledge')
        .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
      while (this.entries.length > this.maxEntries && removable.length) {
        const victim = removable.shift();
        this.entries = this.entries.filter(entry => entry.id !== victim.id);
      }
    }
  }

  search(query, { limit = 5, kind = null, semantic = false } = {}) {
    const queryTokens = tokens(query);
    if (!queryTokens.length) return [];
    const phrase = String(query).toLowerCase().trim();
    const queryBigrams = new Set();
    const cleanQuery = phrase.replace(/[^a-z0-9\s]/g, '');
    for (let i = 0; i < cleanQuery.length - 1; i++) queryBigrams.add(cleanQuery.slice(i, i + 2));
    const scored = [];
    for (const entry of this.entries) {
      if (kind && entry.kind !== kind) continue;
      const haystack = [entry.topic, entry.title, entry.summary, ...(entry.facts || [])].join(' ');
      let score = 0;
      if (!semantic) {
        const hayTokens = new Set(tokens(haystack));
        for (const token of queryTokens) {
          if (hayTokens.has(token)) score += 3;
          else if (token.length >= 4 && [...hayTokens].some(candidate => candidate.startsWith(token) || token.startsWith(candidate))) score += 1.5;
        }
        if (entry.topic.toLowerCase() === phrase) score += 6;
        else if (entry.topic.toLowerCase().includes(phrase) || phrase.includes(entry.topic.toLowerCase())) score += 3;
      } else {
        const cleanHay = haystack.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const hayBigrams = new Set();
        for (let i = 0; i < cleanHay.length - 1; i++) hayBigrams.add(cleanHay.slice(i, i + 2));
        let overlap = 0;
        for (const bg of queryBigrams) if (hayBigrams.has(bg)) overlap++;
        score = overlap * 2;
      }
      if (score <= 0) continue;
      scored.push({ entry, score });
    }
    return scored
      .sort((left, right) => right.score - left.score || String(right.entry.updatedAt).localeCompare(String(left.entry.updatedAt)))
      .slice(0, Math.max(1, Math.min(20, limit)))
      .map(({ entry }) => {
        entry.hits = (entry.hits || 0) + 1;
        entry.lastUsedAt = new Date().toISOString();
        return { ...entry };
      });
  }

  list({ limit = 10, kind = 'knowledge' } = {}) {
    return this.entries
      .filter(entry => !kind || entry.kind === kind)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(entry => ({ ...entry }));
  }

  recordExperience({ instruction, success = false, message = '', intent = '' }) {
    const topic = `experience ${clampText(instruction, 80)}`;
    return this.upsert({
      topic,
      title: success ? 'Task succeeded' : 'Task failed',
      summary: clampText(`${success ? 'Worked' : 'Failed'}: ${clampText(message, 400)}`, MAX_SUMMARY_LENGTH),
      facts: intent ? [`intent: ${intent}`] : [],
      source: 'self',
      kind: 'experience'
    });
  }

  addGap(topic) {
    const value = clampText(topic, MAX_TOPIC_LENGTH);
    if (!value) return false;
    const key = value.toLowerCase();
    if (this.queue.some(entry => String(entry.topic).toLowerCase() === key)) return false;
    this.queue.push({ topic: value, at: new Date().toISOString() });
    if (this.queue.length > MAX_QUEUE) this.queue = this.queue.slice(-MAX_QUEUE);
    this.write();
    return true;
  }

  nextGap() {
    const next = this.queue.shift();
    if (!next) return null;
    this.write();
    return next.topic;
  }

  getTraining() {
    return { ...this.training };
  }

  setTraining(patch = {}) {
    this.training = { ...this.training, ...patch, updatedAt: new Date().toISOString() };
    this.write();
    return this.getTraining();
  }

  stats() {
    const knowledge = this.entries.filter(entry => entry.kind === 'knowledge');
    return {
      topics: knowledge.length,
      facts: knowledge.reduce((sum, entry) => sum + (entry.facts?.length || 0), 0),
      experiences: this.entries.length - knowledge.length,
      queued: this.queue.length,
      lastTopic: this.training.lastTopic || null,
      lastRunAt: this.training.lastRunAt || null,
      cycles: this.training.cycles || 0,
      ...this.getTraining()
    };
  }
}

module.exports = {
  AIKnowledge,
  DEFAULT_KNOWLEDGE_PATH,
  slugify
};
