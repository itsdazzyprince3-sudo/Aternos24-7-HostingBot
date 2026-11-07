'use strict';

const { AIKnowledge } = require('./ai-knowledge');
const { getAIModel } = require('./ai-model');

const DEFAULT_INTERVAL_MS = 90000;
const MIN_INTERVAL_MS = 15000;
const MAX_INTERVAL_MS = 3600000;
const DEFAULT_TIMEOUT_MS = 12000;
const WIKI_API = 'https://minecraft.wiki/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'VirgoMinecraftBot/2.2 (+https://github.com/itsdazzyprince3-sudo/Aternos24-7-HostingBot)';

const CURRICULUM = [
  'Mining', 'Diamond Ore', 'Iron Ore', 'Gold Ore', 'Ancient Debris', 'Coal Ore',
  'Copper Ore', 'Redstone Ore', 'Lapis Lazuli Ore', 'Emerald Ore', 'Cave', 'Lava',
  'Water Bucket', 'Torch', 'Light level', 'Mob spawning', 'Hunger', 'Food',
  'Cooking', 'Farming', 'Wheat', 'Carrot', 'Potato', 'Breeding', 'Animal',
  'Zombie', 'Skeleton', 'Creeper', 'Spider', 'Enderman', 'Witch', 'Pillager',
  'Raid', 'Village', 'Trading', 'Villager', 'Armor', 'Shield', 'Sword',
  'Pickaxe', 'Axe', 'Bow', 'Crossbow', 'Trident', 'Fishing', 'Crafting Table',
  'Furnace', 'Chest', 'Barrel', 'Bed', 'Shelter', 'Boat', 'Scaffolding',
  'Enchanting', 'Anvil', 'Brewing', 'Experience', 'Redstone', 'Piston',
  'Observer', 'Hopper', 'Nether Portal', 'Nether', 'Blaze', 'Ghast', 'Piglin',
  'Bastion Remnant', 'Nether Fortress', 'Stronghold', 'End Portal',
  'Ender Dragon', 'End City', 'Elytra', 'Daylight cycle', 'Weather',
  'Thunderstorm', 'Difficulty', 'Respawn', 'Spawn point', 'Wolf', 'Cat',
  'Horse', 'Iron Golem', 'Snow Golem', 'Bee', 'Axolotl'
];

// Bare command words are not research topics; queueing them as gaps
// sends the trainer off to study useless Wikipedia stubs like "come".
const GAP_STOPWORDS = new Set([
  'come', 'follow', 'stay', 'eat', 'sleep', 'farm', 'mine', 'craft', 'build',
  'defend', 'explore', 'fish', 'train', 'stop', 'status', 'resume', 'pause',
  'attack', 'grind', 'tunnel', 'smelt', 'equip', 'breed', 'deliver', 'withdraw',
  'store', 'hunt', 'help', 'brain', 'why', 'think', 'solve', 'recognize',
  'research', 'knowledge', 'memory', 'inventory', 'health', 'food', 'time',
  'players', 'nearby', 'stats', 'skills', 'skill', 'plan', 'recipe', 'teach'
]);

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\[?(?:[^\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\[(?:\d+|citation needed|edit|note \d+)\]/gi, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFacts(text, { limit = 4 } = {}) {
  const clean = cleanText(text)
    .replace(/={2,}[^=]{0,80}={2,}/g, '. ')
    .replace(/\b(?:Navigation|Contents|References|External links|See also|Issues|History)\b/gi, '. ');
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const facts = [];
  const seen = new Set();
  for (const sentence of sentences) {
    const fact = sentence.trim();
    if (fact.length < 35 || fact.length > 320) continue;
    if (!/[a-z]{3,}\s+[a-z]{3,}/i.test(fact)) continue;
    if (/^(?:\[edit\]|\|)/i.test(fact)) continue;
    if ((fact.match(/[^a-zA-Z0-9\s,.;:'"()\-%]/g) || []).length > fact.length * 0.2) continue;
    const key = fact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(fact);
    if (facts.length >= limit) break;
  }
  return facts;
}

function topicKey(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

class AITrainer {
  constructor({
    config = {},
    knowledge,
    memory = null,
    fetchImpl = globalThis.fetch,
    onProgress = () => {},
    log = () => {}
  } = {}) {
    this.config = config || {};
    this.training = this.config.training || {};
    this.search = this.config.search || {};
    this.knowledge = knowledge || new AIKnowledge();
    this.memory = memory;
    this.fetchImpl = fetchImpl;
    this.onProgress = onProgress;
    this.log = log;
    this.intervalMs = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS,
      Number(this.training.intervalMs) || DEFAULT_INTERVAL_MS));
    this.timeoutMs = Math.max(2000, Math.min(30000, Number(this.training.timeoutMs) || DEFAULT_TIMEOUT_MS));
    this.running = false;
    this.timer = null;
    this.iterationsLeft = Infinity;
    this.cyclesThisRun = 0;
    this.failedTopics = new Map();
    this.lastResult = null;
    this.lastError = null;
    this.resetCursor();
  }

  resetCursor() {
    this.cursor = Number(this.knowledge.getTraining().cursor) || 0;
  }

  status() {
    const stats = this.knowledge.stats();
    let modelStats = null;
    try {
      modelStats = getAIModel().status();
    } catch {
      // ignore
    }
    return {
      running: this.running,
      intervalMs: this.intervalMs,
      cyclesThisRun: this.cyclesThisRun,
      iterationsLeft: Number.isFinite(this.iterationsLeft) ? this.iterationsLeft : null,
      nextTopic: this.pickTopic(),
      lastResult: this.lastResult,
      lastError: this.lastError,
      model: modelStats,
      ...stats
    };
  }

  statusText() {
    const status = this.status();
    const state = status.running ? 'training' : 'idle';
    const learned = `${status.topics} topics and ${status.facts} facts`;
    const queued = status.queued ? `, ${status.queued} gaps queued` : '';
    const last = status.lastTopic ? ` Last topic: ${status.lastTopic}.` : '';
    const remaining = status.trainingUntil ? ` ${Math.max(0, Math.ceil((status.trainingUntil - Date.now()) / 3600000))} hours remain.` : '';
    const error = status.lastError ? ` Last error: ${status.lastError}` : '';
    const modelNote = status.model ? ` Neural model: ${status.model.totalEpochs} epochs (${status.model.policyActions} actions, ${status.model.langIntents} intents).` : '';
    return `Self-training is ${state}. I have ${learned}${queued}; ${status.cycles} total cycles.${last}${remaining}${modelNote}${error}`;
  }

  async getJson(url, options = {}) {
    if (!this.fetchImpl) throw new Error('Web access is unavailable in this runtime.');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(options.headers || {}) },
        signal: controller.signal
      });
      if (!response?.ok) return null;
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async searchMinecraftWiki(query) {
    try {
      const searchUrl = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=2&format=json&origin=*`;
      const data = await this.getJson(searchUrl);
      const hits = data?.query?.search || [];
      const results = [];
      for (const hit of hits.slice(0, 2)) {
        let extract = '';
        try {
          const extractUrl = `${WIKI_API}?action=query&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=${encodeURIComponent(hit.title)}&format=json&origin=*`;
          const extractData = await this.getJson(extractUrl);
          const pages = Object.values(extractData?.query?.pages || {});
          extract = String(pages[0]?.extract || '');
        } catch {
          // Fall through to the search snippet.
        }
        const content = cleanText(extract) || cleanText(hit.snippet);
        results.push({
          title: hit.title,
          url: `https://minecraft.wiki/w/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
          content,
          source: 'minecraft.wiki'
        });
      }
      return results.filter(result => result.content);
    } catch {
      return [];
    }
  }

  async searchWikipedia(query) {
    try {
      const searchUrl = `${WIKIPEDIA_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`;
      const data = await this.getJson(searchUrl);
      const hit = data?.query?.search?.[0];
      if (!hit) return [];
      const extractUrl = `${WIKIPEDIA_API}?action=query&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=${encodeURIComponent(hit.title)}&format=json&origin=*`;
      const extractData = await this.getJson(extractUrl);
      const pages = Object.values(extractData?.query?.pages || {});
      const content = cleanText(pages[0]?.extract) || cleanText(hit.snippet);
      if (!content) return [];
      return [{
        title: hit.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
        content,
        source: 'wikipedia.org'
      }];
    } catch {
      return [];
    }
  }

  async searchTavily(query) {
    const apiKey = process.env[this.search.apiKeyEnv || 'TAVILY_API_KEY'];
    if (this.search.enabled !== true || this.search.provider !== 'tavily' || !apiKey || !this.fetchImpl) return [];
    try {
      const data = await this.getJson('https://api.tavily.com/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: String(query).slice(0, 400),
          max_results: Math.max(1, Math.min(5, Number(this.search.maxResults) || 3)),
          search_depth: 'basic'
        })
      });
      return (Array.isArray(data?.results) ? data.results : []).flatMap(result => {
        try {
          const url = new URL(result.url);
          if (url.protocol !== 'https:') return [];
          return [{
            title: String(result.title || 'Source').slice(0, 120),
            url: url.href,
            content: cleanText(result.content || result.snippet),
            source: url.hostname
          }];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  async searchWeb(query) {
    const cleaned = String(query || '').trim();
    if (cleaned.length < 2 || cleaned.length > 200) throw new Error('Research topics must be between 2 and 200 characters.');
    const tavily = await this.searchTavily(cleaned);
    if (tavily.length) return tavily;
    const wiki = await this.searchMinecraftWiki(cleaned);
    if (wiki.length) return wiki;
    return this.searchWikipedia(cleaned);
  }

  async research(topic, { quiet = false, verify = true } = {}) {
    const cleaned = String(topic || '').trim();
    if (cleaned.length < 2 || cleaned.length > 200) throw new Error('Research topics must be between 2 and 200 characters.');
    const results = await this.searchWeb(cleaned);
    if (!results.length) throw new Error(`I could not find web sources for "${cleaned}".`);
    const primary = results.slice().sort((left, right) => (right.content?.length || 0) - (left.content?.length || 0))[0];
    // cross-source verification: keep facts appearing in at least 2 sources
    let facts = [];
    if (verify && results.length >= 2) {
      const sourceFacts = results.map(r => extractFacts(r.content, { limit: 10 }));
      const factCounts = new Map();
      for (const sf of sourceFacts) {
        for (const fact of sf) {
          const key = fact.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
          factCounts.set(key, (factCounts.get(key) || 0) + 1);
        }
      }
      facts = [...factCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, Number(this.training.maxFactsPerTopic) || 4)
        .map(([fact]) => fact);
    }
    if (!facts.length) {
      const combined = results.map(result => result.content).filter(Boolean).join(' ');
      facts = extractFacts(combined, { limit: Number(this.training.maxFactsPerTopic) || 4 });
    }
    if (!facts.length) throw new Error(`I found sources for "${cleaned}" but could not extract a usable lesson.`);
    const summary = facts.join(' ').slice(0, 600);
    const entry = this.knowledge.upsert({
      topic: cleaned,
      title: primary?.title || results[0].title,
      summary,
      facts,
      source: primary?.source || results[0].source,
      url: primary?.url || results[0].url,
      kind: 'knowledge',
      verified: verify && facts.length > 0
    });
    const previous = this.knowledge.getTraining();
    this.knowledge.setTraining({
      cycles: (Number(previous.cycles) || 0) + 1,
      factsLearned: (Number(previous.factsLearned) || 0) + facts.length,
      lastTopic: cleaned,
      lastRunAt: new Date().toISOString(),
      cursor: this.cursor
    });
    this.lastResult = {
      topic: cleaned,
      title: entry.title,
      summary,
      facts: facts.length,
      source: entry.url || entry.source
    };
    this.lastError = null;
    if (!quiet) {
      const message = `Learned ${facts.length} fact${facts.length === 1 ? '' : 's'} about ${cleaned} from ${entry.source || 'the web'}.`;
      this.log(`[Training] ${message}`);
      this.onProgress(message);
    }
    return this.lastResult;
  }

  pickTopic() {
    const gap = this.knowledge.queue?.[0]?.topic;
    if (gap) return gap;
    const learned = new Set(this.knowledge.entries
      .filter(entry => entry.kind === 'knowledge')
      .map(entry => topicKey(entry.topic)));
    const unlearned = CURRICULUM.filter(topic => !learned.has(topicKey(topic)));
    const fresh = unlearned.find(topic => (this.failedTopics.get(topicKey(topic)) || 0) < 2) || unlearned[0];
    if (fresh) return fresh;
    const staleCandidates = this.knowledge.entries
      .filter(entry => entry.kind === 'knowledge')
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
    const stale = staleCandidates.find(entry => (this.failedTopics.get(topicKey(entry.topic)) || 0) < 2) || staleCandidates[0];
    if (stale) return stale.topic;
    if (!CURRICULUM.length) return null;
    const topic = CURRICULUM[this.cursor % CURRICULUM.length];
    this.cursor += 1;
    return topic;
  }

  async cycle() {
    const queued = this.knowledge.queue?.length ? this.knowledge.nextGap() : null;
    const topic = queued || this.pickTopic();
    if (!topic) return null;
    // periodic knowledge review: 10% chance to refresh an old entry
    if (Math.random() < 0.1) {
      const oldEntries = this.knowledge.entries
        .filter(e => e.kind === 'knowledge' && e.updatedAt)
        .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
      if (oldEntries.length) {
        const stale = oldEntries[0];
        try {
          await this.research(stale.topic, { quiet: true, verify: true });
          this.log(`[Training] Refreshed knowledge: ${stale.topic}`);
        } catch {
          // ignore refresh failures
        }
      }
    }
    if (!topic) return null;
    // fast initial learning: first 5 cycles at 10s
    const isFast = this.cyclesThisRun < 5;
    const delay = isFast ? 10000 : this.intervalMs;
    if (!topic) return null;
    try {
      const result = await this.research(topic, { quiet: true });
      this.failedTopics.delete(topicKey(topic));
      this.log(`[Training] Learned ${result.topic}: ${result.summary.slice(0, 120)}`);
      this.onProgress(`Learned about ${result.topic} (${result.facts} facts) from ${result.source}.`);
      return result;
    } catch (error) {
      const key = topicKey(topic);
      this.failedTopics.set(key, (this.failedTopics.get(key) || 0) + 1);
      this.cursor = (this.cursor + 1) % Math.max(1, CURRICULUM.length);
      this.lastError = error.message;
      this.log(`[Training] Skipped ${topic}: ${error.message}`);
      return null;
    }
  }

  schedule() {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (!this.running) return;
      const trainingUntil = Number(this.knowledge.getTraining().trainingUntil);
      if ((Number.isFinite(trainingUntil) && trainingUntil > 0 && Date.now() >= trainingUntil) || this.iterationsLeft <= 0) {
        this.running = false;
        this.knowledge.setTraining({ running: false, autoResume: false, trainingUntil: null, trainingFinished: true });
        this.log('[Training] Finished the requested training run.');
        return;
      }
      try {
        await this.cycle();
      } finally {
        if (Number.isFinite(this.iterationsLeft)) this.iterationsLeft -= 1;
        this.cyclesThisRun += 1;
        const finishedAt = Number(this.knowledge.getTraining().trainingUntil);
        if (this.iterationsLeft <= 0 || (Number.isFinite(finishedAt) && finishedAt > 0 && Date.now() >= finishedAt)) {
          this.running = false;
          this.knowledge.setTraining({ running: false, autoResume: false, trainingUntil: null, trainingFinished: true });
          this.log('[Training] Finished the requested training run.');
          return;
        }
        this.schedule();
      }
    }, this.iterationsLeft === 0 ? 0 : Math.min(this.intervalMs, this.cyclesThisRun < 5 ? 10000 : this.intervalMs));
    this.timer.unref?.();
  }

  start({ iterations = Infinity, autoResume = true, durationMs = this.training.durationMs } = {}) {
    if (this.training.enabled === false) throw new Error('Self-training is disabled in settings.json.');
    if (this.running) return this.status();
    this.running = true;
    this.iterationsLeft = Number.isFinite(iterations) ? Math.max(0, Math.floor(iterations)) : Infinity;
    this.cyclesThisRun = 0;
    const duration = Number(durationMs);
    const trainingUntil = Number.isFinite(duration) && duration > 0 ? Date.now() + duration : null;
    this.knowledge.setTraining({
      running: true,
      autoResume: Boolean(autoResume),
      userStopped: false,
      trainingUntil,
      trainingFinished: false
    });
    this.schedule();
    return this.status();
  }

  startForever() {
    return this.start({ iterations: Infinity, autoResume: true });
  }

  autoStart() {
    const state = this.knowledge.getTraining();
    if (state.userStopped === true || state.trainingFinished === true) return this.status();
    const until = Number(state.trainingUntil);
    if (Number.isFinite(until) && until > 0) {
      const remaining = until - Date.now();
      if (remaining <= 0) {
        this.knowledge.setTraining({ running: false, autoResume: false, trainingUntil: null, trainingFinished: true });
        return this.status();
      }
      return this.start({ iterations: Infinity, autoResume: true, durationMs: remaining });
    }
    return this.startForever();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.knowledge.setTraining({ running: false, autoResume: false, userStopped: true });
    return this.status();
  }

  noteGap(topic) {
    const cleaned = String(topic || '')
      .replace(/^(?:please\s+)?(?:can you\s+)?/i, '')
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (GAP_STOPWORDS.has(cleaned.toLowerCase())) return false;
    if (cleaned.length < 4) return false;
    return this.knowledge.addGap(cleaned);
  }

  recordExperience({ instruction = '', success = false, message = '', intent = '' } = {}) {
    this.knowledge.recordExperience({ instruction, success, message, intent });
    try {
      getAIModel().trainOnExperience({ instruction, success, message, intent });
    } catch {
      // Model training failure should not break experience recording
    }
    if (!success) this.noteGap(instruction || intent);
  }

  trainNeuralModel({ epochs = 10, onProgress = () => {} } = {}) {
    const model = getAIModel();
    const result = model.trainModel({
      epochs,
      onProgress: info => {
        this.log(`[Neural Model] Epoch ${info.epoch}/${info.totalEpochs} | Policy Loss: ${info.policyLoss.toFixed(4)} (${info.policyAcc.toFixed(1)}%) | Lang Loss: ${info.langLoss.toFixed(4)} (${info.langAcc.toFixed(1)}%)`);
        onProgress(info);
      }
    });
    return result;
  }
}

module.exports = {
  AITrainer,
  CURRICULUM,
  DEFAULT_INTERVAL_MS,
  cleanText,
  extractFacts
};
