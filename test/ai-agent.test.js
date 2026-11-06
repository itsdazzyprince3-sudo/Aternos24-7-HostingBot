'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { AIAgent, LOW_HEALTH_THRESHOLD, MAX_INSTRUCTION_LENGTH } = require('../lib/ai-agent');
const { parseGeminiInteraction } = require('../lib/gemini-interactions');

const noOpMemory = {
  getNotes: () => [],
  addNote: () => {}
};

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

test('autonomous gathering is opt-in and can be paused and resumed', async () => {
  const agent = new AIAgent({
    config: { enabled: true, autonomous: { enabled: false } },
    getBot: () => null,
    isConnected: () => true,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Request aborted.')), { once: true });
    })
  });
  assert.throws(() => agent.startAutonomous(), /disabled/);

  const previousKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = 'test-key';
  try {
    agent.config.autonomous.enabled = true;
    assert.equal(agent.startAutonomous().status, 'working');
    assert.equal(agent.autonomyActive, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    const paused = agent.pauseAutonomous();
    assert.equal(paused.paused, true);
    assert.equal(agent.autonomyActive, false);
    assert.equal(agent.getStatus().status, 'stopped');
  } finally {
    if (previousKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousKey;
  }
});

test('autonomous tasks cannot use non-gathering tools or mine unapproved blocks', async () => {
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => ({}),
    isConnected: () => true
  });
  agent.isAutonomousTask = true;
  await assert.rejects(
    agent.executeTool('craft_item', JSON.stringify({ item: 'oak_planks' })),
    /cannot use the craft_item action/
  );
  await assert.rejects(
    agent.executeTool('mine_block', JSON.stringify({ block: 'diamond_ore' })),
    /limited to/
  );
});

test('autonomous mining never exceeds the per-cycle block limit', async () => {
  const bot = {
    registry: { blocksByName: { stone: { id: 1 } } },
    inventory: { items: () => [] }
  };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true
  });
  agent.isAutonomousTask = true;
  agent.autonomousBlocksMined = 24;
  const result = await agent.mineBlock(bot, { block: 'stone', count: 8 });
  assert.equal(result.mined, 0);
  assert.match(result.message, /block limit/);
});

test('autonomous mining accepts exposed blocks but rejects blocks under a roof', () => {
  const targetPosition = new Vec3(0, 0, 0);
  const target = {
    name: 'stone',
    id: 1,
    position: targetPosition,
    diggable: true
  };
  let roofHeight = null;
  const bot = {
    entity: { position: new Vec3(0, 0, 2) },
    health: 20,
    entities: {},
    pathfinder: { bestHarvestTool: () => ({ name: 'iron_pickaxe' }) },
    findBlocks: options => {
      if (options.point) return [];
      return [targetPosition];
    },
    blockAt: position => {
      if (position.y === targetPosition.y) return target;
      if (roofHeight === position.y) return { name: 'dirt' };
      return { name: 'air' };
    }
  };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true
  });

  assert.equal(agent.findSafeAutonomousBlock(bot, 1), target);
  roofHeight = 8;
  assert.equal(agent.findSafeAutonomousBlock(bot, 1), null);
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
    memory: noOpMemory,
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

test('AI task uses Gemini Interactions with tool results and chained interactions', async () => {
  const previous = {
    apiKey: process.env.AI_API_KEY,
    apiUrl: process.env.AI_API_URL,
    model: process.env.AI_MODEL
  };
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  process.env.AI_MODEL = 'gemini-3.5-flash';
  const requests = [];
  const responses = [
    {
      id: 'interaction-1',
      status: 'requires_action',
      steps: [{
        type: 'function_call',
        id: 'observe-call-1',
        name: 'observe',
        arguments: {}
      }]
    },
    {
      id: 'interaction-2',
      status: 'requires_action',
      steps: [{
        type: 'function_call',
        id: 'finish-call-2',
        name: 'finish_task',
        arguments: { message: 'Done.' }
      }]
    }
  ];
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => ({}),
    isConnected: () => true,
    memory: {
      getNotes: () => ['Always keep oak logs.'],
      addNote: () => {}
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => responses.shift() };
    }
  });
  agent.executeTool = async name => name === 'observe'
    ? { health: 20, inventory: [] }
    : { finished: true, message: 'Done.' };

  try {
    agent.start('Gather wood.');
    for (let attempt = 0; attempt < 30 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    assert.equal(agent.getStatus().status, 'completed');
    assert.equal(agent.getStatus().message, 'Done.');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(requests[0].options.headers['x-goog-api-key'], 'test-key');
    assert.equal(requests[0].options.headers.Authorization, undefined);
    const firstBody = JSON.parse(requests[0].options.body);
    assert.equal(firstBody.model, 'gemini-3.5-flash');
    assert.equal(firstBody.input, 'Gather wood.');
    assert.match(firstBody.system_instruction, /You are Virgo/);
    assert.match(firstBody.system_instruction, /Always keep oak logs/);
    assert.deepEqual(firstBody.tools[0], { type: 'google_search' });
    assert.equal(firstBody.tools.find(tool => tool.name === 'observe').type, 'function');

    const secondBody = JSON.parse(requests[1].options.body);
    assert.equal(secondBody.previous_interaction_id, 'interaction-1');
    assert.deepEqual(secondBody.input, [{
      type: 'function_result',
      call_id: 'observe-call-1',
      name: 'observe',
      result: { health: 20, inventory: [] }
    }]);
  } finally {
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previous.apiKey;
    if (previous.apiUrl === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = previous.apiUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previous.model;
  }
});

test('AI task retries temporary Gemini 503 responses with bounded backoff', async () => {
  const previous = {
    apiKey: process.env.AI_API_KEY,
    apiUrl: process.env.AI_API_URL,
    model: process.env.AI_MODEL
  };
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  process.env.AI_MODEL = 'gemini-3.5-flash';
  let requestCount = 0;
  const retryDelays = [];
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => ({}),
    isConnected: () => true,
    memory: noOpMemory,
    sleep: async milliseconds => retryDelays.push(milliseconds),
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount < 3) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => '0.5' },
          text: async () => 'Temporarily unavailable'
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: 'interaction-recovered',
          status: 'requires_action',
          steps: [{
            type: 'function_call',
            id: 'finish-recovered',
            name: 'finish_task',
            arguments: { message: 'Done after retry.' }
          }]
        })
      };
    }
  });

  try {
    agent.start('Answer after retry.');
    for (let attempt = 0; attempt < 30 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(agent.getStatus().status, 'completed');
    assert.equal(agent.getStatus().message, 'Done after retry.');
    assert.equal(requestCount, 3);
    assert.deepEqual(retryDelays, [500, 500]);
  } finally {
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previous.apiKey;
    if (previous.apiUrl === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = previous.apiUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previous.model;
  }
});

test('HTTP 429 pauses autonomous gathering without retrying or scheduling another cycle', async () => {
  const previous = {
    apiKey: process.env.AI_API_KEY,
    apiUrl: process.env.AI_API_URL,
    model: process.env.AI_MODEL
  };
  process.env.AI_API_KEY = 'test-key';
  delete process.env.AI_API_URL;
  delete process.env.AI_MODEL;
  let requests = 0;
  const agent = new AIAgent({
    config: {
      enabled: true,
      autonomous: { enabled: true },
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta/interactions',
      model: 'gemini-3.5-flash-lite'
    },
    getBot: () => ({}),
    isConnected: () => true,
    fetchImpl: async () => {
      requests += 1;
      return {
        ok: false,
        status: 429,
        headers: { get: () => null },
        text: async () => '{"error":{"message":"You exceeded your current quota"}}'
      };
    }
  });

  try {
    agent.startAutonomous();
    for (let attempt = 0; attempt < 20 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(requests, 1);
    assert.equal(agent.autonomyActive, false);
    assert.equal(agent.isAutonomousTask, false);
    assert.equal(agent.autonomousTimer, null);
    assert.equal(agent.getStatus().status, 'error');
    assert.match(agent.getStatus().message, /HTTP 429.*paused/);
  } finally {
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previous.apiKey;
    if (previous.apiUrl === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = previous.apiUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previous.model;
  }
});

test('AI task reports a clear message when Gemini remains unavailable after retries', async () => {
  const previous = {
    apiKey: process.env.AI_API_KEY,
    apiUrl: process.env.AI_API_URL,
    model: process.env.AI_MODEL
  };
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  process.env.AI_MODEL = 'gemini-3.5-flash';
  let requestCount = 0;
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => ({}),
    isConnected: () => true,
    memory: noOpMemory,
    sleep: async () => {},
    fetchImpl: async () => {
      requestCount += 1;
      return {
        ok: false,
        status: 503,
        text: async () => 'High demand'
      };
    }
  });

  try {
    agent.start('Answer during outage.');
    for (let attempt = 0; attempt < 30 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(requestCount, 3);
    assert.equal(agent.getStatus().status, 'error');
    assert.match(agent.getStatus().message, /temporarily unavailable/);
    assert.match(agent.getStatus().message, /try !ai again/);
  } finally {
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previous.apiKey;
    if (previous.apiUrl === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = previous.apiUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previous.model;
  }
});

test('AI task can answer a question with a plain model response', async () => {
  const previousKey = process.env.AI_API_KEY;
  const previousUrl = process.env.AI_API_URL;
  const previousModel = process.env.AI_MODEL;
  process.env.AI_API_KEY = 'test-key';
  delete process.env.AI_API_URL;
  delete process.env.AI_MODEL;
  const agent = new AIAgent({
    config: { enabled: true, model: 'gemini-3.5-flash-lite' },
    getBot: () => ({}),
    isConnected: () => true,
    memory: noOpMemory,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        id: 'interaction-answer',
        status: 'completed',
        steps: [{
          type: 'model_output',
          content: [{ type: 'text', text: 'You have three logs.' }]
        }]
      })
    })
  });

  try {
    agent.start('How many logs do I have?');
    for (let attempt = 0; attempt < 20 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(agent.getStatus().status, 'completed');
    assert.equal(agent.getStatus().message, 'You have three logs.');
  } finally {
    if (previousKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = previousUrl;
    if (previousModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previousModel;
  }
});

test('Gemini text-only interactions are parsed as answers', () => {
  const parsed = parseGeminiInteraction({
    id: 'interaction-answer',
    status: 'completed',
    steps: [{
      type: 'model_output',
      content: [{
        type: 'text',
        text: 'There are three logs.',
        annotations: [{
          type: 'url_citation',
          title: 'Minecraft Wiki',
          url: 'https://minecraft.wiki/w/Log'
        }]
      }]
    }]
  });
  assert.equal(parsed.text, 'There are three logs.');
  assert.deepEqual(parsed.citations, [{
    title: 'Minecraft Wiki',
    url: 'https://minecraft.wiki/w/Log'
  }]);
});

test('Gemini web-grounded answers retain source domains in the response', async () => {
  const previous = {
    apiKey: process.env.AI_API_KEY,
    apiUrl: process.env.AI_API_URL,
    model: process.env.AI_MODEL
  };
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  process.env.AI_MODEL = 'gemini-3.8-flash';
  let requestBody;
  const agent = new AIAgent({
    config: { enabled: true, webSearch: true },
    getBot: () => ({}),
    isConnected: () => true,
    memory: noOpMemory,
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          id: 'interaction-web-answer',
          status: 'completed',
          steps: [{
            type: 'model_output',
            content: [{
              type: 'text',
              text: 'The current answer is grounded.',
              annotations: [{
                type: 'url_citation',
                title: 'Example',
                url: 'https://www.example.com/article'
              }]
            }]
          }]
        })
      };
    }
  });

  try {
    agent.start('Search the web for current information.');
    for (let attempt = 0; attempt < 30 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(agent.getStatus().status, 'completed');
    assert.equal(agent.getStatus().message, 'The current answer is grounded. Sources: example.com.');
    assert.deepEqual(requestBody.tools[0], { type: 'google_search' });
  } finally {
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previous.apiKey;
    if (previous.apiUrl === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = previous.apiUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previous.model;
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

test('survival defense attacks known hostile mobs but never players', () => {
  const zombie = { type: 'mob', name: 'zombie', position: new Vec3(3, 0, 0) };
  const player = { type: 'player', name: 'player', position: new Vec3(1, 0, 0) };
  const attacked = [];
  const bot = {
    entity: { position: new Vec3(0, 0, 0) },
    entities: { zombie, player },
    health: 20,
    attack: entity => attacked.push(entity)
  };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true,
    memory: noOpMemory
  });

  agent.checkSurvival();
  assert.deepEqual(attacked, [zombie]);

  bot.entities = { player };
  agent.lastDefenseActionAt = 0;
  agent.checkSurvival();
  assert.deepEqual(attacked, [zombie]);
});

test('survival defense retreats from nearby hostiles at the low-health threshold', async () => {
  const goals = [];
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      zombie: { type: 'mob', name: 'zombie', position: new Vec3(2, 64, 0) }
    },
    health: LOW_HEALTH_THRESHOLD,
    pathfinder: { goto: async goal => goals.push(goal) },
    clearControlStates() {}
  };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true,
    memory: noOpMemory
  });

  agent.checkSurvival();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(goals.length, 1);
  assert.equal(goals[0].x, -12);
  assert.equal(goals[0].rangeSq, 4);
  assert.equal(agent.survivalAction, false);
});

test('survival defense retreats from a nearby creeper instead of attacking it', async () => {
  const goals = [];
  const attacks = [];
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      creeper: { type: 'mob', name: 'creeper', position: new Vec3(4, 64, 0) }
    },
    health: 20,
    pathfinder: { goto: async goal => goals.push(goal) },
    attack: entity => attacks.push(entity),
    clearControlStates() {}
  };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true,
    memory: noOpMemory
  });

  agent.checkSurvival();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(goals.length, 1);
  assert.deepEqual(attacks, []);
});

test('death recovery returns for missing inventory when the location is safe', async () => {
  let items = [{ name: 'oak_log', count: 3 }];
  const goals = [];
  const bot = {
    entity: { position: new Vec3(1, 64, 0) },
    entities: {},
    health: 20,
    inventory: { items: () => items },
    pathfinder: {
      goto: async goal => {
        goals.push(goal);
        items = [{ name: 'oak_log', count: 3 }];
      }
    }
  };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true,
    memory: noOpMemory,
    sleep: async () => {}
  });

  agent.recordDeath();
  items = [];
  const result = await agent.recoverDroppedItems();

  assert.equal(goals.length, 1);
  assert.deepEqual(result.recovered, [{ item: 'oak_log', count: 3 }]);
  assert.equal(agent.hasDeathRecovery(), false);
});

test('item delivery is limited to the trusted requester', async () => {
  const tossed = [];
  const recipient = {
    username: 'Virgo',
    entity: { position: new Vec3(2, 64, 0) }
  };
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    players: { Virgo: recipient, OtherPlayer: { username: 'OtherPlayer', entity: recipient.entity } },
    registry: { itemsByName: { oak_log: { id: 1 } } },
    inventory: { items: () => [{ name: 'oak_log', count: 5 }] },
    pathfinder: { goto: async () => {} },
    toss: async (...args) => tossed.push(args)
  };
  const agent = new AIAgent({
    config: { enabled: true },
    getBot: () => bot,
    isConnected: () => true,
    memory: noOpMemory
  });
  agent.requestedBy = 'Virgo';

  const result = await agent.executeTool('deliver_item', JSON.stringify({ item: 'oak_log', count: 2 }));
  assert.deepEqual(result, { delivered: 'oak_log', count: 2, recipient: 'Virgo' });
  assert.deepEqual(tossed, [[1, null, 2]]);

  agent.requestedBy = null;
  await assert.rejects(
    agent.executeTool('deliver_item', JSON.stringify({ item: 'oak_log' })),
    /trusted player/
  );
});


test('auto provider falls back to local Ollama and answers without a cloud API key', async () => {
  const previous = {
    apiKey: process.env.AI_API_KEY,
    provider: process.env.AI_PROVIDER,
    model: process.env.AI_MODEL,
    url: process.env.OLLAMA_URL,
    ollamaModel: process.env.OLLAMA_MODEL
  };
  delete process.env.AI_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.OLLAMA_URL;
  delete process.env.OLLAMA_MODEL;
  const requests = [];
  const bot = {
    username: 'commotozze',
    entity: { position: new Vec3(3, 64, -4) },
    health: 20,
    food: 20,
    oxygenLevel: 300,
    time: { timeOfDay: 1000, day: 2, isDay: true },
    inventory: { items: () => [] },
    findBlocks: () => [],
    blockAt: () => null,
    entities: {},
    players: {}
  };
  const agent = new AIAgent({
    config: {
      enabled: true,
      provider: 'auto',
      ollama: { enabled: true, url: 'http://127.0.0.1:11434/api/chat', model: 'qwen2.5:1.5b' }
    },
    getBot: () => bot,
    isConnected: () => true,
    memory: noOpMemory,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ message: { content: 'Hello! I am ready.' } }) };
    }
  });

  try {
    assert.equal(agent.resolveProvider(), 'local');
    agent.start('How should I prepare my village for a snowstorm?', 'virgo');
    for (let attempt = 0; attempt < 50 && agent.getStatus().status === 'working'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(agent.getStatus().status, 'completed');
    assert.equal(agent.getStatus().message, 'Hello! I am ready.');
    assert.equal(requests[0].url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(JSON.parse(requests[0].options.body).model, 'qwen2.5:1.5b');
  } finally {
    for (const [key, value] of Object.entries({
      AI_API_KEY: previous.apiKey,
      AI_PROVIDER: previous.provider,
      AI_MODEL: previous.model,
      OLLAMA_URL: previous.url,
      OLLAMA_MODEL: previous.ollamaModel
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


test('local web search is opt-in, bounded, and rejects non-HTTPS result links', async () => {
  const priorKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'test-search-key';
  try {
    let called = false;
    const agent = new AIAgent({
      config: { enabled: true, search: { enabled: true, maxResults: 2 } },
      getBot: () => null,
      isConnected: () => false,
      fetchImpl: async (url, options) => {
        called = true;
        assert.equal(url, 'https://api.tavily.com/search');
        assert.equal(options.headers.Authorization, 'Bearer test-search-key');
        assert.equal(JSON.parse(options.body).max_results, 2);
        return { ok: true, json: async () => ({ results: [
          { title: 'Current result', url: 'https://example.com/page', content: 'Evidence' },
          { title: 'Unsafe', url: 'http://example.com/', content: 'Discard this' }
        ] }) };
      }
    });
    assert.equal(agent.shouldSearchLocal('What is the latest Minecraft release?'), true);
    assert.equal(agent.shouldSearchLocal('What is a crafting table?'), false);
    const results = await agent.searchLocalWeb('latest Minecraft release');
    assert.equal(called, true);
    assert.deepEqual(results, [{ title: 'Current result', url: 'https://example.com/page', content: 'Evidence' }]);
  } finally {
    if (priorKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = priorKey;
  }
});

test('local web search does not run unless enabled in settings', async () => {
  let called = false;
  const agent = new AIAgent({
    config: { enabled: true, search: { enabled: false } },
    getBot: () => null,
    isConnected: () => false,
    fetchImpl: async () => { called = true; throw new Error('should not be called'); }
  });
  assert.equal(agent.shouldSearchLocal('What is the latest release?'), false);
  assert.deepEqual(await agent.searchLocalWeb('latest release'), []);
  assert.equal(called, false);
});

test('local model includes web evidence and cites its source URLs', async () => {
  const agent = new AIAgent({
    config: { enabled: true, ollama: { enabled: true, url: 'http://localhost/api/chat', model: 'test' } },
    getBot: () => null,
    isConnected: () => false,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.match(body.messages[0].content, /untrusted web search results/i);
      assert.match(body.messages[0].content, /https:\/\/example\.com\/page/);
      return { ok: true, json: async () => ({ message: { content: 'Version information found.' } }) };
    }
  });
  const reply = await agent.askLocalModel('latest version?', { health: 20, food: 20, inventory: {} }, [
    { title: 'Release', url: 'https://example.com/page', content: 'The current release.' }
  ]);
  assert.match(reply, /Sources: \[1\] https:\/\/example\.com\/page/);
});
