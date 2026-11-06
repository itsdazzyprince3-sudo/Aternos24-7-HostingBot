'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AIAgent, MAX_INSTRUCTION_LENGTH } = require('../lib/ai-agent');

test('AI instructions are validated before starting', () => {
  const agent = new AIAgent({
    config: { enabled: false },
    getBot: () => null,
    isConnected: () => false
  });

  assert.throws(() => agent.start(''), /between 1 and/);
  assert.throws(() => agent.start('x'.repeat(MAX_INSTRUCTION_LENGTH + 1)), /between 1 and/);
  assert.throws(() => agent.start('mine stone'), /disabled/);
});

test('AI task uses the configured model API and can finish a task', async () => {
  const previousKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = 'test-key';
  const bot = { pathfinder: {}, clearControlStates() {} };
  let request;
  const agent = new AIAgent({
    config: { enabled: true, model: 'test-model', apiUrl: 'https://example.test/v1/chat/completions' },
    getBot: () => bot,
    isConnected: () => true,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'finish-1',
                type: 'function',
                function: {
                  name: 'finish_task',
                  arguments: JSON.stringify({ message: 'Done.' })
                }
              }]
            }
          }]
        })
      };
    }
  });

  try {
    agent.start('Mine stone.');
    for (let attempt = 0; attempt < 20 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(agent.getStatus().status, 'completed');
    assert.equal(agent.getStatus().message, 'Done.');
    assert.equal(request.url, 'https://example.test/v1/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(request.options.body);
    assert.equal(body.model, 'test-model');
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /Mine stone\./);
  } finally {
    if (previousKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousKey;
  }
});

test('AI task reports model API errors rather than claiming success', async () => {
  const previousKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = 'test-key';
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => ({}),
    isConnected: () => true,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    })
  });

  try {
    agent.start('Gather wood.');
    for (let attempt = 0; attempt < 20 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(agent.getStatus().status, 'error');
    assert.match(agent.getStatus().message, /HTTP 401/);
  } finally {
    if (previousKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousKey;
  }
});

test('AI crafts inventory-ready items without requiring a crafting table', async () => {
  const recipe = { requiresTable: false, result: { count: 4 } };
  const craftCalls = [];
  const bot = {
    registry: { itemsByName: { oak_planks: { id: 5 } } },
    recipesFor: (itemId, metadata, count, table) => {
      assert.equal(itemId, 5);
      assert.equal(table, null);
      return [recipe];
    },
    craft: async (...args) => craftCalls.push(args)
  };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true
  });

  const result = await agent.executeTool('craft_item', JSON.stringify({ item: 'oak_planks', count: 4 }));

  assert.deepEqual(result, { crafted: 'oak_planks', count: 4 });
  assert.deepEqual(craftCalls, [[recipe, 1, null]]);
});

test('stopping an AI task aborts its pending model request', async () => {
  const previousKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = 'test-key';
  const bot = { pathfinder: { stop() {} }, clearControlStates() {} };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true,
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Request aborted.')));
    })
  });

  try {
    agent.start('Gather wood.');
    await new Promise(resolve => setTimeout(resolve, 0));
    agent.stop();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(agent.getStatus().status, 'stopped');
  } finally {
    if (previousKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousKey;
  }
});
