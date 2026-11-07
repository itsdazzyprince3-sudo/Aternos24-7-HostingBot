'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AIKnowledge } = require('../lib/ai-knowledge');

function temporaryKnowledge() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'virgo-knowledge-'));
  return { directory, file: path.join(directory, 'knowledge.json') };
}

test('knowledge persists topics, facts, and queues across restarts', () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    knowledge.upsert({
      topic: 'Creeper',
      title: 'Creeper',
      summary: 'A creeper explodes when it gets close.',
      facts: ['A creeper hisses before exploding.', 'A shield blocks creeper damage.'],
      source: 'minecraft.wiki',
      url: 'https://minecraft.wiki/w/Creeper'
    });
    knowledge.addGap('Iron Ore');
    knowledge.setTraining({ cycles: 3 });

    const reloaded = new AIKnowledge(file);
    const [entry] = reloaded.search('creeper', { limit: 1 });
    assert.equal(entry.topic, 'Creeper');
    assert.equal(entry.facts.length, 2);
    assert.equal(reloaded.nextGap(), 'Iron Ore');
    assert.equal(reloaded.getTraining().cycles, 3);
    assert.equal(reloaded.stats().topics, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('knowledge search ranks topic matches and ignores unrelated entries', () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    knowledge.upsert({ topic: 'Diamond Ore', title: 'Diamond Ore', summary: 'Drops diamonds when mined.', facts: [] });
    knowledge.upsert({ topic: 'Wheat', title: 'Wheat', summary: 'Grows on farmland.', facts: [] });
    const results = knowledge.search('how do I mine diamond ore', { limit: 5 });
    assert.equal(results[0].topic, 'Diamond Ore');
    assert.ok(results.every(result => result.topic !== 'Wheat'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('experience records keep failures searchable and queue new gaps', () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    knowledge.recordExperience({
      instruction: 'mine diamond ore',
      success: false,
      message: 'No iron_pickaxe in my inventory.',
      intent: 'mine'
    });
    const [entry] = knowledge.search('diamond ore', { limit: 1 });
    assert.match(entry.summary, /Failed/);
    assert.equal(knowledge.stats().experiences, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('repeated task experiences retain both successes and failures across reloads', () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    knowledge.recordExperience({
      instruction: 'mine diamond ore',
      success: false,
      message: 'No iron_pickaxe in my inventory.',
      intent: 'mine'
    });
    knowledge.recordExperience({
      instruction: 'mine diamond ore',
      success: true,
      message: 'Collected 4 diamonds after crafting an iron pickaxe.',
      intent: 'mine'
    });

    const reloaded = new AIKnowledge(file);
    const experiences = reloaded.search('mine diamond ore', { limit: 5, kind: 'experience' });
    assert.equal(reloaded.stats().experiences, 2);
    assert.deepEqual(new Set(experiences.map(entry => entry.title)), new Set(['Task failed', 'Task succeeded']));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
