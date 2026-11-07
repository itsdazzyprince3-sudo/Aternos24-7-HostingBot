'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AIKnowledge } = require('../lib/ai-knowledge');
const { AITrainer, cleanText, extractFacts } = require('../lib/ai-training');

function temporaryKnowledge() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'virgo-training-'));
  return { directory, file: path.join(directory, 'knowledge.json') };
}

function fakeWikiFetch() {
  return async url => {
    const target = String(url);
    if (target.includes('minecraft.wiki') && target.includes('list=search')) {
      return {
        ok: true,
        json: async () => ({
          query: {
            search: [
              { title: 'Creeper', snippet: '<span>Creeper</span> is a hostile mob that explodes.' },
              { title: 'Creeper face', snippet: 'A creeper face is a block pattern.' }
            ]
          }
        })
      };
    }
    if (target.includes('minecraft.wiki') && target.includes('prop=extracts')) {
      return {
        ok: true,
        json: async () => ({
          query: {
            pages: {
              1: {
                extract: 'A creeper is a common hostile mob that quietly approaches a player, hisses, and explodes if the player remains near. Creeper explosions can destroy blocks and deal massive damage, which can be completely blocked using a shield.'
              }
            }
          }
        })
      };
    }
    return { ok: false, json: async () => ({}) };
  };
}

test('research fetches wiki knowledge and stores extractive facts', async () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    const trainer = new AITrainer({ knowledge, fetchImpl: fakeWikiFetch(), config: { training: { maxFactsPerTopic: 3 } } });
    const result = await trainer.research('Creeper');
    assert.match(result.summary, /hostile mob/i);
    assert.ok(result.facts >= 2);
    const [entry] = knowledge.search('creeper', { limit: 1 });
    assert.equal(entry.topic, 'Creeper');
    assert.equal(entry.source, 'minecraft.wiki');
    assert.equal(knowledge.stats().cycles, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('queued gaps are researched before fresh curriculum topics', async () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    knowledge.addGap('Creeper');
    const trainer = new AITrainer({ knowledge, fetchImpl: fakeWikiFetch(), config: {} });
    const result = await trainer.cycle();
    assert.equal(result.topic, 'Creeper');
    assert.equal(knowledge.stats().queued, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('training can start, report status, and stop persistently', () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    const trainer = new AITrainer({ knowledge, fetchImpl: fakeWikiFetch(), config: { training: { intervalMs: 60000 } } });
    trainer.start({ iterations: 2 });
    assert.equal(trainer.status().running, true);
    assert.match(trainer.statusText(), /Self-training is training/);
    trainer.stop();
    assert.equal(trainer.status().running, false);
    assert.equal(knowledge.getTraining().userStopped, true);
    trainer.autoStart();
    assert.equal(trainer.status().running, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a timed training run sets a deadline, reports hours, and expires cleanly', () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    const trainer = new AITrainer({ knowledge, fetchImpl: fakeWikiFetch(), config: { training: { intervalMs: 60000 } } });
    trainer.start({ iterations: Infinity, durationMs: 36000000 });
    assert.equal(trainer.status().running, true);
    assert.match(trainer.statusText(), /hours remain/);
    const until = Number(knowledge.getTraining().trainingUntil);
    assert.ok(Number.isFinite(until) && until > Date.now());
    trainer.stop();
    assert.equal(trainer.status().running, false);

    knowledge.setTraining({ trainingUntil: Date.now() - 1000, userStopped: false, trainingFinished: false });
    trainer.autoStart();
    assert.equal(trainer.status().running, false);
    assert.equal(knowledge.getTraining().trainingFinished, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a failed research cycle returns null and records the error without throwing', async () => {
  const { directory, file } = temporaryKnowledge();
  try {
    const knowledge = new AIKnowledge(file);
    const trainer = new AITrainer({
      knowledge,
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
      config: {}
    });
    const result = await trainer.cycle();
    assert.equal(result, null);
    assert.match(trainer.lastError, /could not find|could not extract/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('training text cleanup strips wiki markup', () => {
  assert.equal(cleanText('<span>Diamond ore</span> is [[ore|rare]].'), 'Diamond ore is rare.');
  const facts = extractFacts('Diamond ore is a rare ore that generates deep underground, and drops diamonds when mined. It needs an iron pickaxe to drop anything.');
  assert.equal(facts.length, 2);
  assert.match(facts[0], /diamond ore/i);
});
