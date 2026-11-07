'use strict';

// Full-Stack Pure-JS Neural Network, Tensor Architecture,
// Tactical Policy Predictor & Language Model Engine for Virgo AI Bot.
// Zero external binary dependencies; runs in Termux, Node.js, and browser runtimes.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WEIGHTS_PATH = path.resolve(__dirname, '..', 'data', 'ai-model-weights.json');

// ---------------------------------------------------------
// 1. Math, Tensor & Activation Functions
// ---------------------------------------------------------

function randomNormal(mean = 0, std = 1) {
  // Box-Muller transform
  const u1 = Math.max(1e-15, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * std;
}

function zeros(size) {
  return new Float64Array(size);
}

function createMatrix(rows, cols, initFn = () => 0) {
  const matrix = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const row = new Float64Array(cols);
    for (let j = 0; j < cols; j++) {
      row[j] = initFn(i, j);
    }
    matrix[i] = row;
  }
  return matrix;
}

function relu(x) {
  return x > 0 ? x : 0;
}

function reluPrime(x) {
  return x > 0 ? 1 : 0;
}

function sigmoid(x) {
  if (x > 40) return 1;
  if (x < -40) return 0;
  return 1 / (1 + Math.exp(-x));
}

function sigmoidPrime(s) {
  return s * (1 - s);
}

function tanh(x) {
  return Math.tanh(x);
}

function tanhPrime(t) {
  return 1 - t * t;
}

function softmax(logits) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] > max) max = logits[i];
  }
  let sum = 0;
  const probs = new Float64Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    probs[i] = Math.exp(Math.max(-500, logits[i] - max));
    sum += probs[i];
  }
  if (sum <= 0) sum = 1;
  for (let i = 0; i < logits.length; i++) {
    probs[i] /= sum;
  }
  return probs;
}

function dot(a, b) {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function argmax(arr) {
  let bestIdx = 0;
  let bestVal = arr[0] ?? -Infinity;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > bestVal) {
      bestVal = arr[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ---------------------------------------------------------
// 2. Adam Optimizer
// ---------------------------------------------------------

class AdamOptimizer {
  constructor({ lr = 0.003, beta1 = 0.9, beta2 = 0.999, eps = 1e-8 } = {}) {
    this.lr = lr;
    this.beta1 = beta1;
    this.beta2 = beta2;
    this.eps = eps;
    this.t = 0;
    this.m = new Map(); // paramKey -> array/matrix
    this.v = new Map();
  }

  step(paramKey, weights, grads) {
    this.t += 1;
    const is2D = Array.isArray(weights) && (weights[0] instanceof Float64Array || Array.isArray(weights[0]));

    if (is2D) {
      if (!this.m.has(paramKey)) {
        this.m.set(paramKey, createMatrix(weights.length, weights[0].length));
        this.v.set(paramKey, createMatrix(weights.length, weights[0].length));
      }
      const M = this.m.get(paramKey);
      const V = this.v.get(paramKey);
      const beta1Correction = 1 - Math.pow(this.beta1, this.t);
      const beta2Correction = 1 - Math.pow(this.beta2, this.t);

      for (let r = 0; r < weights.length; r++) {
        for (let c = 0; c < weights[0].length; c++) {
          const g = grads[r][c];
          M[r][c] = this.beta1 * M[r][c] + (1 - this.beta1) * g;
          V[r][c] = this.beta2 * V[r][c] + (1 - this.beta2) * g * g;

          const mHat = M[r][c] / (beta1Correction || 1);
          const vHat = V[r][c] / (beta2Correction || 1);
          weights[r][c] -= (this.lr * mHat) / (Math.sqrt(vHat) + this.eps);
        }
      }
    } else {
      if (!this.m.has(paramKey)) {
        this.m.set(paramKey, new Float64Array(weights.length));
        this.v.set(paramKey, new Float64Array(weights.length));
      }
      const M = this.m.get(paramKey);
      const V = this.v.get(paramKey);
      const beta1Correction = 1 - Math.pow(this.beta1, this.t);
      const beta2Correction = 1 - Math.pow(this.beta2, this.t);

      for (let i = 0; i < weights.length; i++) {
        const g = grads[i];
        M[i] = this.beta1 * M[i] + (1 - this.beta1) * g;
        V[i] = this.beta2 * V[i] + (1 - this.beta2) * g * g;

        const mHat = M[i] / (beta1Correction || 1);
        const vHat = V[i] / (beta2Correction || 1);
        weights[i] -= (this.lr * mHat) / (Math.sqrt(vHat) + this.eps);
      }
    }
  }

  reset() {
    this.t = 0;
    this.m.clear();
    this.v.clear();
  }
}

// ---------------------------------------------------------
// 3. Dense Layer Architecture
// ---------------------------------------------------------

class DenseLayer {
  constructor(inFeatures, outFeatures, activation = 'relu', name = 'dense') {
    this.inFeatures = inFeatures;
    this.outFeatures = outFeatures;
    this.activation = activation;
    this.name = name;

    // He initialization for ReLU, Xavier for tanh/sigmoid/linear
    const std = activation === 'relu'
      ? Math.sqrt(2.0 / inFeatures)
      : Math.sqrt(1.0 / inFeatures);

    this.weights = createMatrix(inFeatures, outFeatures, () => randomNormal(0, std));
    this.biases = new Float64Array(outFeatures);

    // Cache for backpropagation
    this.lastInput = null;
    this.lastPreActivation = null;
    this.lastOutput = null;
  }

  forward(input) {
    this.lastInput = input;
    const z = new Float64Array(this.outFeatures);

    for (let j = 0; j < this.outFeatures; j++) {
      let sum = this.biases[j];
      for (let i = 0; i < this.inFeatures; i++) {
        sum += input[i] * this.weights[i][j];
      }
      z[j] = sum;
    }
    this.lastPreActivation = z;

    const out = new Float64Array(this.outFeatures);
    if (this.activation === 'relu') {
      for (let j = 0; j < this.outFeatures; j++) out[j] = relu(z[j]);
    } else if (this.activation === 'tanh') {
      for (let j = 0; j < this.outFeatures; j++) out[j] = tanh(z[j]);
    } else if (this.activation === 'sigmoid') {
      for (let j = 0; j < this.outFeatures; j++) out[j] = sigmoid(z[j]);
    } else if (this.activation === 'softmax') {
      return softmax(z);
    } else {
      for (let j = 0; j < this.outFeatures; j++) out[j] = z[j];
    }
    this.lastOutput = out;
    return out;
  }

  backward(gradOutput, optimizer) {
    const dZ = new Float64Array(this.outFeatures);

    if (this.activation === 'relu') {
      for (let j = 0; j < this.outFeatures; j++) {
        dZ[j] = gradOutput[j] * reluPrime(this.lastPreActivation[j]);
      }
    } else if (this.activation === 'tanh') {
      for (let j = 0; j < this.outFeatures; j++) {
        dZ[j] = gradOutput[j] * tanhPrime(this.lastOutput[j]);
      }
    } else if (this.activation === 'sigmoid') {
      for (let j = 0; j < this.outFeatures; j++) {
        dZ[j] = gradOutput[j] * sigmoidPrime(this.lastOutput[j]);
      }
    } else {
      // Linear or softmax with cross-entropy already computed
      for (let j = 0; j < this.outFeatures; j++) {
        dZ[j] = gradOutput[j];
      }
    }

    // Gradients for weights: dW = input^T * dZ
    const gradW = createMatrix(this.inFeatures, this.outFeatures);
    for (let i = 0; i < this.inFeatures; i++) {
      for (let j = 0; j < this.outFeatures; j++) {
        gradW[i][j] = this.lastInput[i] * dZ[j];
      }
    }

    // Gradients for biases: dB = dZ
    const gradB = new Float64Array(dZ);

    // Gradient to pass back to earlier layer: dInput = dZ * W^T
    const gradInput = new Float64Array(this.inFeatures);
    for (let i = 0; i < this.inFeatures; i++) {
      let sum = 0;
      for (let j = 0; j < this.outFeatures; j++) {
        sum += dZ[j] * this.weights[i][j];
      }
      gradInput[i] = sum;
    }

    // Update weights and biases via optimizer
    if (optimizer) {
      optimizer.step(`${this.name}_w`, this.weights, gradW);
      optimizer.step(`${this.name}_b`, this.biases, gradB);
    }

    return gradInput;
  }

  toJSON() {
    return {
      name: this.name,
      inFeatures: this.inFeatures,
      outFeatures: this.outFeatures,
      activation: this.activation,
      weights: this.weights.map(row => Array.from(row)),
      biases: Array.from(this.biases)
    };
  }

  fromJSON(data) {
    this.inFeatures = data.inFeatures;
    this.outFeatures = data.outFeatures;
    this.activation = data.activation;
    this.name = data.name || this.name;
    this.weights = data.weights.map(row => new Float64Array(row));
    this.biases = new Float64Array(data.biases);
  }
}

// ---------------------------------------------------------
// 4. Tactical Action Policy Network
// ---------------------------------------------------------

const POLICY_ACTIONS = [
  'retreat',
  'defend',
  'gatherFood',
  'gatherWood',
  'mineStone',
  'mineIron',
  'mineDiamond',
  'craftTools',
  'craftArmor',
  'buildShelter',
  'farm',
  'breed',
  'smelt',
  'sleep',
  'explore',
  'fish'
];

const STATE_DIMENSION = 24;

class PolicyNetwork {
  constructor({ lr = 0.003 } = {}) {
    this.actions = POLICY_ACTIONS.slice();
    this.actionIndex = new Map(this.actions.map((act, i) => [act, i]));
    this.optimizer = new AdamOptimizer({ lr });

    // Multi-Layer Perceptron: 24 -> 48 (ReLU) -> 32 (ReLU) -> 16 (Softmax)
    this.layers = [
      new DenseLayer(STATE_DIMENSION, 48, 'relu', 'policy_l1'),
      new DenseLayer(48, 32, 'relu', 'policy_l2'),
      new DenseLayer(32, this.actions.length, 'linear', 'policy_l3')
    ];
  }

  static encodeObservation(observation) {
    const vec = new Float64Array(STATE_DIMENSION);
    const health = Number(observation?.health ?? 20);
    const food = Number(observation?.food ?? 20);
    const isDay = observation?.time?.isDay !== false ? 1 : 0;
    const hostiles = observation?.nearbyHostiles || [];
    const threat = hostiles[0] || null;
    const inv = observation?.inventory || {};
    const armor = observation?.armor || {};

    const armorCount = ['helmet', 'chestplate', 'leggings', 'boots'].filter(s => Boolean(armor[s])).length;

    // 0: Normalized health (0..1)
    vec[0] = Math.max(0, Math.min(20, health)) / 20;
    // 1: Normalized food (0..1)
    vec[1] = Math.max(0, Math.min(20, food)) / 20;
    // 2: Day indicator (1 = day, 0 = night)
    vec[2] = isDay;
    // 3: Threat detected (1 or 0)
    vec[3] = threat ? 1 : 0;
    // 4: Normalized threat proximity (1 = immediate, 0 = far/none)
    vec[4] = threat ? Math.max(0, 1 - (threat.distance || 16) / 32) : 0;
    // 5: Threat is explosive (Creeper)
    vec[5] = threat && /creeper/i.test(threat.name || '') ? 1 : 0;
    // 6: Threat is ranged (Skeleton)
    vec[6] = threat && /skeleton/i.test(threat.name || '') ? 1 : 0;
    // 7: Threat is melee (Zombie/Spider)
    vec[7] = threat && /zombie|spider/i.test(threat.name || '') ? 1 : 0;
    // 8: Threat is Enderman/dangerous
    vec[8] = threat && /enderman|warden|wither/i.test(threat.name || '') ? 1 : 0;

    // Inventory items & tool tiers
    let pickTier = 0;
    if (inv.netherite_pickaxe) pickTier = 5;
    else if (inv.diamond_pickaxe) pickTier = 4;
    else if (inv.iron_pickaxe) pickTier = 3;
    else if (inv.stone_pickaxe) pickTier = 2;
    else if (inv.wooden_pickaxe || inv.golden_pickaxe) pickTier = 1;
    // 9: Pickaxe tier (0..1)
    vec[9] = pickTier / 5;

    // 10: Has sword
    vec[10] = (inv.diamond_sword || inv.iron_sword || inv.stone_sword || inv.wooden_sword) ? 1 : 0;
    // 11: Has shield
    vec[11] = inv.shield ? 1 : 0;
    // 12: Armor coverage ratio (0..1)
    vec[12] = armorCount / 4;

    // Resource counts
    const logs = (inv.oak_log || 0) + (inv.birch_log || 0) + (inv.spruce_log || 0) + (inv.dark_oak_log || 0);
    const planks = (inv.oak_planks || 0) + (inv.birch_planks || 0) + (inv.spruce_planks || 0);
    const cobble = (inv.cobblestone || 0) + (inv.stone || 0);
    const rawIron = (inv.raw_iron || 0) + (inv.iron_ore || 0);
    const ironIngots = (inv.iron_ingot || 0);
    const diamonds = (inv.diamond || 0);
    const foodCount = (inv.bread || 0) + (inv.cooked_beef || 0) + (inv.cooked_porkchop || 0) + (inv.apple || 0) + (inv.baked_potato || 0);

    // 13: Logs (0..1)
    vec[13] = Math.min(logs, 64) / 64;
    // 14: Planks (0..1)
    vec[14] = Math.min(planks, 64) / 64;
    // 15: Cobblestone (0..1)
    vec[15] = Math.min(cobble, 64) / 64;
    // 16: Iron (raw + ingots) (0..1)
    vec[16] = Math.min(rawIron + ironIngots, 64) / 64;
    // 17: Diamonds (0..1)
    vec[17] = Math.min(diamonds, 32) / 32;
    // 18: Ready food count (0..1)
    vec[18] = Math.min(foodCount, 32) / 32;

    // Station & Survival utilities
    // 19: Has crafting table
    vec[19] = inv.crafting_table ? 1 : 0;
    // 20: Has furnace
    vec[20] = inv.furnace ? 1 : 0;
    // 21: Has bed
    vec[21] = (inv.white_bed || inv.red_bed || inv.blue_bed || inv.black_bed) ? 1 : 0;
    // 22: Has torches
    vec[22] = (inv.torch || 0) > 0 ? 1 : 0;
    // 23: Has water bucket
    vec[23] = inv.water_bucket ? 1 : 0;

    return vec;
  }

  forward(stateVector) {
    let current = stateVector;
    for (let i = 0; i < this.layers.length - 1; i++) {
      current = this.layers[i].forward(current);
    }
    const logits = this.layers[this.layers.length - 1].forward(current);
    return softmax(logits);
  }

  predict(observation) {
    const vector = PolicyNetwork.encodeObservation(observation);
    const probs = this.forward(vector);
    const bestIdx = argmax(probs);
    const action = this.actions[bestIdx];
    const probability = probs[bestIdx];

    const distribution = {};
    for (let i = 0; i < this.actions.length; i++) {
      distribution[this.actions[i]] = Number(probs[i].toFixed(4));
    }

    return {
      action,
      probability: Number(probability.toFixed(4)),
      bestIndex: bestIdx,
      distribution,
      vector
    };
  }

  trainStep(stateVector, targetActionIndex) {
    const probs = this.forward(stateVector);

    // Cross-Entropy Loss gradient: dL/dLogit = p_i - y_i
    const gradLogits = new Float64Array(this.actions.length);
    for (let i = 0; i < this.actions.length; i++) {
      gradLogits[i] = probs[i] - (i === targetActionIndex ? 1 : 0);
    }

    const loss = -Math.log(Math.max(1e-12, probs[targetActionIndex]));

    // Backprop through layers
    let grad = gradLogits;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      grad = this.layers[i].backward(grad, this.optimizer);
    }

    const predIdx = argmax(probs);
    const correct = predIdx === targetActionIndex ? 1 : 0;

    return { loss, correct };
  }

  toJSON() {
    return {
      version: 1,
      type: 'PolicyNetwork',
      actions: this.actions,
      layers: this.layers.map(l => l.toJSON())
    };
  }

  fromJSON(data) {
    if (!data?.layers) return;
    this.actions = Array.isArray(data.actions) ? data.actions : POLICY_ACTIONS;
    this.actionIndex = new Map(this.actions.map((act, i) => [act, i]));
    for (let i = 0; i < Math.min(this.layers.length, data.layers.length); i++) {
      this.layers[i].fromJSON(data.layers[i]);
    }
  }
}

// ---------------------------------------------------------
// 5. Conversational & Language Intent Network
// ---------------------------------------------------------

const INTENT_CLASSES = [
  'greeting',
  'question_recipe',
  'question_knowledge',
  'task_mine',
  'task_craft',
  'task_smelt',
  'task_combat',
  'task_follow',
  'task_explore',
  'task_build',
  'task_farm',
  'status_query',
  'help',
  'gratitude',
  'deliberate_think',
  'autonomous_grind'
];

class LanguageTokenizer {
  constructor(initialVocab = []) {
    this.special = ['<pad>', '<unk>', '<bos>', '<eos>'];
    this.wordToId = new Map();
    this.idToWord = [];

    for (const token of this.special) {
      this.addToken(token);
    }
    for (const word of initialVocab) {
      this.addToken(word);
    }
  }

  addToken(token) {
    const clean = String(token || '').toLowerCase().trim();
    if (!clean || this.wordToId.has(clean)) return this.wordToId.get(clean);
    const id = this.idToWord.length;
    this.idToWord.push(clean);
    this.wordToId.set(clean, id);
    return id;
  }

  tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  encode(text, maxLength = 24) {
    const words = this.tokenize(text);
    const vector = new Int32Array(maxLength);
    // <bos> = 2, <pad> = 0, <unk> = 1
    vector[0] = 2; // <bos>
    let idx = 1;
    for (const w of words) {
      if (idx >= maxLength - 1) break;
      const id = this.wordToId.has(w) ? this.wordToId.get(w) : 1; // <unk>
      vector[idx++] = id;
    }
    vector[idx] = 3; // <eos>
    return vector;
  }

  bagOfWords(text, vocabSize = 300) {
    const words = this.tokenize(text);
    const bow = new Float64Array(vocabSize);
    for (const w of words) {
      const id = this.wordToId.get(w);
      if (id !== undefined && id < vocabSize) {
        bow[id] += 1;
      }
    }
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vocabSize; i++) norm += bow[i] * bow[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vocabSize; i++) bow[i] /= norm;
    }
    return bow;
  }
}

class LanguageNetwork {
  constructor({ lr = 0.003, vocabSize = 320 } = {}) {
    this.vocabSize = vocabSize;
    this.intents = INTENT_CLASSES.slice();
    this.intentIndex = new Map(this.intents.map((name, i) => [name, i]));
    this.tokenizer = new LanguageTokenizer();
    this.optimizer = new AdamOptimizer({ lr });

    // Seed default vocabulary
    const seedWords = [
      'mine', 'craft', 'build', 'kill', 'fight', 'attack', 'follow', 'come', 'stay',
      'explore', 'farm', 'smelt', 'cook', 'recipe', 'how', 'what', 'where', 'who',
      'why', 'iron', 'diamond', 'stone', 'wood', 'pickaxe', 'sword', 'shield',
      'armor', 'helmet', 'chestplate', 'leggings', 'boots', 'zombie', 'skeleton',
      'creeper', 'spider', 'enderman', 'dragon', 'wither', 'warden', 'elytra',
      'shulker', 'portal', 'nether', 'bed', 'food', 'bread', 'health', 'status',
      'inventory', 'coords', 'help', 'hi', 'hello', 'hey', 'thanks', 'ty', 'good',
      'grind', 'auto', 'think', 'solve', 'reason', 'plan', 'skills', 'train'
    ];
    for (const w of seedWords) this.tokenizer.addToken(w);

    // Bag-of-Words -> 64 (ReLU) -> 32 (ReLU) -> Intent count (Linear/Softmax)
    this.layers = [
      new DenseLayer(this.vocabSize, 64, 'relu', 'lang_l1'),
      new DenseLayer(64, 32, 'relu', 'lang_l2'),
      new DenseLayer(32, this.intents.length, 'linear', 'lang_l3')
    ];
  }

  predictIntent(text) {
    const bow = this.tokenizer.bagOfWords(text, this.vocabSize);
    let current = bow;
    for (let i = 0; i < this.layers.length - 1; i++) {
      current = this.layers[i].forward(current);
    }
    const logits = this.layers[this.layers.length - 1].forward(current);
    const probs = softmax(logits);
    const bestIdx = argmax(probs);

    return {
      intent: this.intents[bestIdx],
      confidence: Number(probs[bestIdx].toFixed(4)),
      probabilities: Array.from(probs).map(p => Number(p.toFixed(4)))
    };
  }

  trainStep(text, targetIntentName) {
    const targetIdx = this.intentIndex.get(targetIntentName);
    if (targetIdx === undefined) return { loss: 0, correct: 0 };

    // Register tokens into tokenizer if needed
    for (const w of this.tokenizer.tokenize(text)) {
      if (this.tokenizer.idToWord.length < this.vocabSize) {
        this.tokenizer.addToken(w);
      }
    }

    const bow = this.tokenizer.bagOfWords(text, this.vocabSize);
    let current = bow;
    for (let i = 0; i < this.layers.length - 1; i++) {
      current = this.layers[i].forward(current);
    }
    const logits = this.layers[this.layers.length - 1].forward(current);
    const probs = softmax(logits);

    const gradLogits = new Float64Array(this.intents.length);
    for (let i = 0; i < this.intents.length; i++) {
      gradLogits[i] = probs[i] - (i === targetIdx ? 1 : 0);
    }

    const loss = -Math.log(Math.max(1e-12, probs[targetIdx]));

    let grad = gradLogits;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      grad = this.layers[i].backward(grad, this.optimizer);
    }

    const predIdx = argmax(probs);
    return { loss, correct: predIdx === targetIdx ? 1 : 0 };
  }

  scoreCandidateReplies(query, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const queryTokens = new Set(this.tokenizer.tokenize(query));
    return candidates.map(candidate => {
      const replyTokens = this.tokenizer.tokenize(candidate);
      let matchCount = 0;
      for (const t of replyTokens) {
        if (queryTokens.has(t)) matchCount++;
      }
      const overlap = matchCount / Math.max(1, Math.sqrt(queryTokens.size * replyTokens.length));
      return {
        reply: candidate,
        score: Number(overlap.toFixed(4))
      };
    }).sort((a, b) => b.score - a.score);
  }

  toJSON() {
    return {
      version: 1,
      type: 'LanguageNetwork',
      vocabSize: this.vocabSize,
      vocab: this.tokenizer.idToWord,
      intents: this.intents,
      layers: this.layers.map(l => l.toJSON())
    };
  }

  fromJSON(data) {
    if (!data) return;
    this.vocabSize = data.vocabSize || this.vocabSize;
    if (Array.isArray(data.vocab)) {
      this.tokenizer = new LanguageTokenizer(data.vocab);
    }
    if (Array.isArray(data.intents)) {
      this.intents = data.intents;
      this.intentIndex = new Map(this.intents.map((name, i) => [name, i]));
    }
    if (Array.isArray(data.layers)) {
      for (let i = 0; i < Math.min(this.layers.length, data.layers.length); i++) {
        this.layers[i].fromJSON(data.layers[i]);
      }
    }
  }
}

// ---------------------------------------------------------
// 6. Dataset Synthesis: Expert Minecraft Curriculum
// ---------------------------------------------------------

function generateExpertPolicyDataset(samples = 120) {
  const dataset = [];

  for (let i = 0; i < samples; i++) {
    // Scenario 1: Critical health & danger -> retreat
    dataset.push({
      obs: { health: 4, food: 10, nearbyHostiles: [{ name: 'creeper', distance: 6 }], inventory: {} },
      target: 'retreat'
    });

    // Scenario 2: Threat close, health healthy -> defend
    dataset.push({
      obs: { health: 18, food: 18, nearbyHostiles: [{ name: 'zombie', distance: 5 }], inventory: { iron_sword: 1 } },
      target: 'defend'
    });

    // Scenario 3: Starving -> gatherFood
    dataset.push({
      obs: { health: 14, food: 3, nearbyHostiles: [], inventory: {} },
      target: 'gatherFood'
    });

    // Scenario 4: No wood, day time -> gatherWood
    dataset.push({
      obs: { health: 20, food: 20, nearbyHostiles: [], inventory: {} },
      target: 'gatherWood'
    });

    // Scenario 5: Has wood, no stone, wooden pickaxe -> mineStone
    dataset.push({
      obs: { health: 20, food: 20, nearbyHostiles: [], inventory: { oak_log: 8, wooden_pickaxe: 1 } },
      target: 'mineStone'
    });

    // Scenario 6: Has stone pickaxe, needs iron -> mineIron
    dataset.push({
      obs: { health: 20, food: 20, nearbyHostiles: [], inventory: { cobblestone: 32, stone_pickaxe: 1 } },
      target: 'mineIron'
    });

    // Scenario 7: Has iron pickaxe + armor, ready for diamonds -> mineDiamond
    dataset.push({
      obs: { health: 20, food: 20, nearbyHostiles: [], inventory: { iron_ingot: 12, iron_pickaxe: 1 }, armor: { chestplate: 'iron_chestplate' } },
      target: 'mineDiamond'
    });

    // Scenario 8: Has logs, needs crafting table or pickaxe -> craftTools
    dataset.push({
      obs: { health: 20, food: 20, nearbyHostiles: [], inventory: { oak_log: 16 } },
      target: 'craftTools'
    });

    // Scenario 9: Has iron ingots, needs armor -> craftArmor
    dataset.push({
      obs: { health: 20, food: 20, nearbyHostiles: [], inventory: { iron_ingot: 24, crafting_table: 1 } },
      target: 'craftArmor'
    });

    // Scenario 10: Night time with bed -> sleep
    dataset.push({
      obs: { health: 20, food: 20, time: { isDay: false }, nearbyHostiles: [], inventory: { white_bed: 1 } },
      target: 'sleep'
    });

    // Scenario 11: Night time without bed -> buildShelter
    dataset.push({
      obs: { health: 16, food: 16, time: { isDay: false }, nearbyHostiles: [{ name: 'skeleton', distance: 20 }], inventory: { cobblestone: 64 } },
      target: 'buildShelter'
    });

    // Scenario 12: Raw iron and furnace -> smelt
    dataset.push({
      obs: { health: 20, food: 20, nearbyHostiles: [], inventory: { raw_iron: 16, furnace: 1, coal: 8 } },
      target: 'smelt'
    });
  }

  return dataset;
}

const EXPERT_LANGUAGE_DATASET = [
  { text: 'hello bot', intent: 'greeting' },
  { text: 'hey virgo', intent: 'greeting' },
  { text: 'good morning', intent: 'greeting' },
  { text: 'yo what is up', intent: 'greeting' },
  { text: 'how do i craft a pickaxe', intent: 'question_recipe' },
  { text: 'what is the recipe for furnace', intent: 'question_recipe' },
  { text: 'how do you make bread', intent: 'question_recipe' },
  { text: 'recipe for diamond sword', intent: 'question_recipe' },
  { text: 'tell me about the warden', intent: 'question_knowledge' },
  { text: 'what does the wither drop', intent: 'question_knowledge' },
  { text: 'where do ancient debris spawn', intent: 'question_knowledge' },
  { text: 'what is elytra', intent: 'question_knowledge' },
  { text: 'mine 8 iron ore', intent: 'task_mine' },
  { text: 'dig some cobblestone', intent: 'task_mine' },
  { text: 'gather 16 oak logs', intent: 'task_mine' },
  { text: 'find diamonds', intent: 'task_mine' },
  { text: 'craft wooden pickaxe', intent: 'task_craft' },
  { text: 'make iron chestplate', intent: 'task_craft' },
  { text: 'craft torches', intent: 'task_craft' },
  { text: 'smelt the iron ore', intent: 'task_smelt' },
  { text: 'cook raw beef', intent: 'task_smelt' },
  { text: 'attack the zombie', intent: 'task_combat' },
  { text: 'kill the creeper', intent: 'task_combat' },
  { text: 'defend me from skeletons', intent: 'task_combat' },
  { text: 'come here', intent: 'task_follow' },
  { text: 'follow me', intent: 'task_follow' },
  { text: 'stay right there', intent: 'task_follow' },
  { text: 'explore the area', intent: 'task_explore' },
  { text: 'scout around the base', intent: 'task_explore' },
  { text: 'build a shelter', intent: 'task_build' },
  { text: 'build a starter house', intent: 'task_build' },
  { text: 'farm the wheat crops', intent: 'task_farm' },
  { text: 'harvest the carrots', intent: 'task_farm' },
  { text: 'what is your health', intent: 'status_query' },
  { text: 'where are you', intent: 'status_query' },
  { text: 'what is in your inventory', intent: 'status_query' },
  { text: 'what can you do', intent: 'help' },
  { text: 'list skills', intent: 'help' },
  { text: 'thank you virgo', intent: 'gratitude' },
  { text: 'thanks great job', intent: 'gratitude' },
  { text: 'think how to survive', intent: 'deliberate_think' },
  { text: 'plan out full diamond armor', intent: 'deliberate_think' },
  { text: 'grind wood', intent: 'autonomous_grind' },
  { text: 'start full auto', intent: 'autonomous_grind' }
];

// ---------------------------------------------------------
// 7. Full-Stack AI Model Engine
// ---------------------------------------------------------

class FullStackAIModel {
  constructor({ weightsPath = DEFAULT_WEIGHTS_PATH, lr = 0.003 } = {}) {
    this.weightsPath = weightsPath;
    this.lr = lr;
    this.policyNet = new PolicyNetwork({ lr });
    this.langNet = new LanguageNetwork({ lr });
    this.isTrained = false;
    this.trainingHistory = {
      totalEpochs: 0,
      policyLossHistory: [],
      langLossHistory: [],
      lastTrainedAt: null
    };

    this.load();
    if (!this.isTrained) {
      this.trainPretrainedBaseline(15);
    }
  }

  trainPretrainedBaseline(epochs = 12) {
    const policyData = generateExpertPolicyDataset(3);
    const langData = EXPERT_LANGUAGE_DATASET;

    for (let ep = 0; ep < epochs; ep++) {
      // Shuffle & train policy
      for (const sample of policyData) {
        const vec = PolicyNetwork.encodeObservation(sample.obs);
        const targetIdx = this.policyNet.actionIndex.get(sample.target);
        if (targetIdx !== undefined) {
          this.policyNet.trainStep(vec, targetIdx);
        }
      }

      // Train language
      for (const sample of langData) {
        this.langNet.trainStep(sample.text, sample.intent);
      }
    }

    this.isTrained = true;
    this.trainingHistory.totalEpochs += epochs;
    this.trainingHistory.lastTrainedAt = new Date().toISOString();
  }

  trainModel({ epochs = 10, batchSize = 16, onProgress = () => {} } = {}) {
    const policyData = generateExpertPolicyDataset(6);
    const langData = EXPERT_LANGUAGE_DATASET;

    let finalPolicyLoss = 0;
    let finalLangLoss = 0;
    let policyAcc = 0;
    let langAcc = 0;

    for (let ep = 1; ep <= epochs; ep++) {
      let epPolicyLoss = 0;
      let epPolicyCorrect = 0;
      for (const sample of policyData) {
        const vec = PolicyNetwork.encodeObservation(sample.obs);
        const targetIdx = this.policyNet.actionIndex.get(sample.target);
        if (targetIdx !== undefined) {
          const res = this.policyNet.trainStep(vec, targetIdx);
          epPolicyLoss += res.loss;
          epPolicyCorrect += res.correct;
        }
      }
      finalPolicyLoss = epPolicyLoss / policyData.length;
      policyAcc = (epPolicyCorrect / policyData.length) * 100;

      let epLangLoss = 0;
      let epLangCorrect = 0;
      for (const sample of langData) {
        const res = this.langNet.trainStep(sample.text, sample.intent);
        epLangLoss += res.loss;
        epLangCorrect += res.correct;
      }
      finalLangLoss = epLangLoss / langData.length;
      langAcc = (epLangCorrect / langData.length) * 100;

      this.trainingHistory.policyLossHistory.push(Number(finalPolicyLoss.toFixed(4)));
      this.trainingHistory.langLossHistory.push(Number(finalLangLoss.toFixed(4)));

      onProgress({
        epoch: ep,
        totalEpochs: epochs,
        policyLoss: finalPolicyLoss,
        policyAcc,
        langLoss: finalLangLoss,
        langAcc
      });
    }

    this.isTrained = true;
    this.trainingHistory.totalEpochs += epochs;
    this.trainingHistory.lastTrainedAt = new Date().toISOString();

    this.save();

    return {
      epochsTrained: epochs,
      totalEpochs: this.trainingHistory.totalEpochs,
      policyLoss: Number(finalPolicyLoss.toFixed(4)),
      policyAccuracy: Number(policyAcc.toFixed(1)),
      langLoss: Number(finalLangLoss.toFixed(4)),
      langAccuracy: Number(langAcc.toFixed(1))
    };
  }

  trainOnExperience(experience) {
    if (!experience || !experience.intent) return null;
    const isSuccess = Boolean(experience.success);

    // If success, reinforce the matching action or intent
    if (this.langNet.intentIndex.has(experience.intent)) {
      this.langNet.trainStep(experience.instruction || experience.intent, experience.intent);
    }

    this.trainingHistory.totalEpochs += 1;
    this.trainingHistory.lastTrainedAt = new Date().toISOString();
    return { trained: true, success: isSuccess };
  }

  predictAction(observation) {
    return this.policyNet.predict(observation);
  }

  predictIntent(text) {
    return this.langNet.predictIntent(text);
  }

  scoreReplies(query, candidates) {
    return this.langNet.scoreCandidateReplies(query, candidates);
  }

  status() {
    return {
      isTrained: this.isTrained,
      totalEpochs: this.trainingHistory.totalEpochs,
      policyLayers: this.policyNet.layers.length,
      policyActions: this.policyNet.actions.length,
      langVocabSize: this.langNet.tokenizer.idToWord.length,
      langIntents: this.langNet.intents.length,
      recentPolicyLoss: this.trainingHistory.policyLossHistory.slice(-5),
      recentLangLoss: this.trainingHistory.langLossHistory.slice(-5),
      lastTrainedAt: this.trainingHistory.lastTrainedAt,
      weightsFile: this.weightsPath
    };
  }

  save(filePath = this.weightsPath) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        trainingHistory: this.trainingHistory,
        policyNet: this.policyNet.toJSON(),
        langNet: this.langNet.toJSON()
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  load(filePath = this.weightsPath) {
    try {
      if (!fs.existsSync(filePath)) return false;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data?.policyNet) this.policyNet.fromJSON(data.policyNet);
      if (data?.langNet) this.langNet.fromJSON(data.langNet);
      if (data?.trainingHistory) {
        this.trainingHistory = {
          ...this.trainingHistory,
          ...data.trainingHistory
        };
      }
      this.isTrained = true;
      return true;
    } catch {
      return false;
    }
  }
}

let activeModel = null;

function getAIModel(options = {}) {
  if (!activeModel) {
    activeModel = new FullStackAIModel(options);
  }
  return activeModel;
}

module.exports = {
  FullStackAIModel,
  PolicyNetwork,
  LanguageNetwork,
  LanguageTokenizer,
  AdamOptimizer,
  DenseLayer,
  POLICY_ACTIONS,
  INTENT_CLASSES,
  STATE_DIMENSION,
  getAIModel,
  softmax,
  relu,
  sigmoid,
  tanh
};
