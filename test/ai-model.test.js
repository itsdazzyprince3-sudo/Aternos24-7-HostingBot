'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  FullStackAIModel,
  PolicyNetwork,
  LanguageNetwork,
  DenseLayer,
  AdamOptimizer,
  softmax,
  relu,
  sigmoid,
  tanh,
  getAIModel
} = require('../lib/ai-model');

const { parseLocalIntent } = require('../lib/ai-brain');
const { getCortex } = require('../lib/ai-cortex');
const { getSkillCatalog } = require('../lib/skill-catalog');
const { getReasoner } = require('../lib/ai-reasoner');

test('math primitives and activations compute correctly', () => {
  assert.equal(relu(5), 5);
  assert.equal(relu(-3), 0);
  assert.ok(sigmoid(0) > 0.49 && sigmoid(0) < 0.51);
  assert.ok(tanh(0) > -0.01 && tanh(0) < 0.01);

  const logits = new Float64Array([2.0, 1.0, 0.1]);
  const probs = softmax(logits);
  assert.equal(probs.length, 3);
  const sum = probs[0] + probs[1] + probs[2];
  assert.ok(Math.abs(sum - 1.0) < 1e-6);
  assert.ok(probs[0] > probs[1] && probs[1] > probs[2]);
});

test('dense layer forward and backward propagation updates parameters', () => {
  const layer = new DenseLayer(4, 2, 'linear', 'test_dense');
  const input = new Float64Array([1.0, 0.5, -0.5, 2.0]);
  const output = layer.forward(input);

  assert.equal(output.length, 2);
  assert.ok(Number.isFinite(output[0]));
  assert.ok(Number.isFinite(output[1]));

  const opt = new AdamOptimizer({ lr: 0.01 });
  const initialWeight = layer.weights[0][0];

  const gradOutput = new Float64Array([0.5, -0.5]);
  const gradInput = layer.backward(gradOutput, opt);

  assert.equal(gradInput.length, 4);
  assert.notEqual(layer.weights[0][0], initialWeight);
});

test('policy network encodes state and predicts valid action distributions', () => {
  const net = new PolicyNetwork();
  const obs = {
    health: 6,
    food: 12,
    nearbyHostiles: [{ name: 'creeper', distance: 4 }],
    inventory: { iron_sword: 1 },
    time: { isDay: false }
  };

  const pred = net.predict(obs);
  assert.ok(pred.action);
  assert.ok(Number.isFinite(pred.probability));
  assert.ok(pred.probability > 0 && pred.probability <= 1.0);
  assert.ok(pred.distribution);
  assert.equal(typeof pred.distribution.retreat, 'number');
  assert.equal(typeof pred.distribution.defend, 'number');
});

test('policy network trains and reduces loss on targeted sample', () => {
  const net = new PolicyNetwork({ lr: 0.05 });
  const sampleObs = { health: 4, food: 10, nearbyHostiles: [{ name: 'creeper', distance: 3 }], inventory: {} };
  const vec = PolicyNetwork.encodeObservation(sampleObs);
  const targetIdx = net.actionIndex.get('retreat');

  const initial = net.trainStep(vec, targetIdx);
  let latestLoss = initial.loss;

  for (let i = 0; i < 25; i++) {
    const res = net.trainStep(vec, targetIdx);
    latestLoss = res.loss;
  }

  assert.ok(latestLoss < initial.loss, `Expected loss reduction: ${latestLoss} < ${initial.loss}`);
  const postPred = net.predict(sampleObs);
  assert.equal(postPred.action, 'retreat');
});

test('language network predicts intents and scores candidate replies', () => {
  const lang = new LanguageNetwork();
  for (let i = 0; i < 15; i++) {
    lang.trainStep('how do i craft a diamond sword', 'question_recipe');
    lang.trainStep('hello virgo bot', 'greeting');
  }

  const predGreeting = lang.predictIntent('hello virgo');
  assert.equal(predGreeting.intent, 'greeting');

  const ranked = lang.scoreCandidateReplies('craft diamond sword', [
    '3 diamond + 2 sticks at crafting table',
    'go to bed and sleep',
    'mine 8 iron ore'
  ]);
  assert.ok(ranked.length === 3);
  assert.match(ranked[0].reply, /diamond/i);
});

test('full stack AI model trains multi-epoch pipeline and persists weights', () => {
  const tempPath = path.resolve(__dirname, '..', 'data', `test-model-weights-${Date.now()}.json`);
  try {
    const model = new FullStackAIModel({ weightsPath: tempPath });
    const trainResult = model.trainModel({ epochs: 3 });

    assert.equal(trainResult.epochsTrained, 3);
    assert.ok(trainResult.policyLoss > 0);
    assert.ok(trainResult.langLoss > 0);
    assert.ok(fs.existsSync(tempPath));

    // Test restoring from saved file
    const loadedModel = new FullStackAIModel({ weightsPath: tempPath });
    assert.ok(loadedModel.isTrained);
    assert.ok(loadedModel.trainingHistory.totalEpochs >= 3);

    const status = loadedModel.status();
    assert.ok(status.isTrained);
    assert.ok(status.policyActions > 10);
    assert.ok(status.langIntents > 10);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
});

test('brain parses model train, status, and eval commands', () => {
  const trainCmd = parseLocalIntent('model train 15');
  assert.deepEqual(trainCmd, { type: 'model', action: 'train', epochs: 15, raw: 'model train 15' });

  const trainNeuralCmd = parseLocalIntent('train neural model 20');
  assert.deepEqual(trainNeuralCmd, { type: 'model', action: 'train', epochs: 20, raw: 'train neural model 20' });

  const statusCmd = parseLocalIntent('model status');
  assert.deepEqual(statusCmd, { type: 'model', action: 'status', raw: 'model status' });

  const evalCmd = parseLocalIntent('model eval');
  assert.deepEqual(evalCmd, { type: 'model', action: 'eval', raw: 'model eval' });
});

test('cortex integrates neural policy network into assessment and deliberation', () => {
  const cortex = getCortex();
  const reasoner = getReasoner({ catalog: getSkillCatalog() });
  const observation = {
    health: 20,
    food: 20,
    inventory: { oak_log: 16 },
    nearbyHostiles: [],
    time: { isDay: true }
  };

  const assessment = cortex.assess(observation);
  assert.ok(assessment.neuralPrediction);
  assert.ok(assessment.neuralPrediction.action);
  assert.ok(assessment.neuralPrediction.probability > 0);

  const decision = cortex.deliberate('craft wooden pickaxe', { observation, reasoner });
  assert.ok(decision);
  assert.ok(decision.thought.some(t => t.includes('[Neural Model]')));
});
