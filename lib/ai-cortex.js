'use strict';

const { bestPickaxe, chooseGoal, TOOL_TIER, total } = require('./ai-brain');

const RISK_BY_SKILL = {
  mine: 0.35,
  stripMine: 0.45,
  huntMob: 0.4,
  attackNearest: 0.4,
  explore: 0.3,
  fish: 0.1,
  buildShelter: 0.15,
  gatherFood: 0.2,
  gatherWood: 0.2,
  farm: 0.05,
  breedAnimal: 0.15,
  deliverToPlayer: 0.25,
  withdrawItem: 0.05,
  storeItem: 0.05,
  equipItem: 0.02,
  ensureItem: 0.1,
  smelt: 0.05,
  sleep: 0.05
};

const ROUTE_ERROR = /path|route|too long|took to long|moved away|unreachable|goal was not reached|no safe|stuck/i;
const MISSING_ERROR = /no .* in my inventory|need (?:a |an |\d+ )?|missing|could not obtain|only obtained|do not have|not enough|requires/i;
const SEARCH_ERROR = /could not find|not visible|no .* nearby|none nearby|no reachable/i;
const HARM_ERROR = /health|retreat|damage|died|low on health|hurt/i;

function inventoryCounts(observation) {
  return observation?.inventory || {};
}

function countItems(inventory, names) {
  return total(inventory, names);
}

function assess(observation, memory = null) {
  const inventory = inventoryCounts(observation);
  const health = Number(observation?.health ?? 20);
  const food = Number(observation?.food ?? 20);
  const hostiles = observation?.nearbyHostiles || [];
  const threat = hostiles[0] || null;
  const isNight = observation?.time?.isDay === false;
  const pickaxe = bestPickaxe(inventory);
  const pickaxeTier = TOOL_TIER[pickaxe] || 0;
  const armor = observation?.armor || {};
  const armorPieces = ['helmet', 'chestplate', 'leggings', 'boots'].filter(slot => Boolean(armor[slot])).length;
  const needs = [];

  if (health <= 8 && threat) needs.push({ kind: 'retreat', urgency: 100 });
  if (threat && threat.distance <= 16) needs.push({ kind: 'defend', urgency: 80 });
  if (food <= 6) needs.push({ kind: 'food', urgency: 92 });
  else if (food <= 12) needs.push({ kind: 'food', urgency: 45 });
  if (health <= 14) needs.push({ kind: 'heal', urgency: 55 });
  if (isNight && !observation?.shelter) needs.push({ kind: 'shelter', urgency: 60 });
  if (pickaxeTier === 0) needs.push({ kind: 'pickaxe', urgency: 70 });
  else if (pickaxeTier < 3) needs.push({ kind: 'upgrade', urgency: 35 });
  if (armorPieces < 4) needs.push({ kind: 'armor', urgency: 30 });
  if (countItems(inventory, ['torch']) < 4) needs.push({ kind: 'light', urgency: 25 });

  needs.sort((left, right) => right.urgency - left.urgency);
  return {
    health,
    food,
    hostiles,
    threat,
    isNight,
    inventory,
    pickaxe,
    pickaxeTier,
    armorPieces,
    needs: needs.slice(0, 5)
  };
}

function successRate(memory, name) {
  const stats = memory?.getSkill?.(name);
  if (!stats || !stats.attempts) return null;
  return Number(stats.successes || 0) / Number(stats.attempts || 1);
}

function scoreGoal(goal, world, memory) {
  let score = Number(goal?.priority) || 10;
  const rate = successRate(memory, `goal:${goal?.skill}`);
  if (rate !== null) score += (rate - 0.5) * 16;
  const risk = RISK_BY_SKILL[goal?.skill] || 0.1;
  const healthFactor = Math.max(0.15, world.health / 20);
  score -= risk * (1 - healthFactor) * 45;
  if (goal?.skill === 'explore' && world.threat) score -= 20;
  if (goal?.skill === 'survive' && !world.threat && world.health > 12) score -= 30;
  return score;
}

function describeWorld(world) {
  const bits = [`health ${world.health}/20`, `food ${world.food}/20`];
  if (world.threat) bits.push(`${world.threat.name} ${world.threat.distance} blocks away`);
  if (world.isNight) bits.push('night');
  bits.push(world.pickaxe ? `${world.pickaxe} in hand` : 'no pickaxe');
  if (world.armorPieces > 0) bits.push(`${world.armorPieces}/4 armor`);
  return `I see ${bits.join(', ')}.`;
}

function curiosityGoals(world, memory) {
  const goals = [];
  const inventory = world.inventory;
  const torches = countItems(inventory, ['torch']);
  const iron = countItems(inventory, ['iron_ingot', 'raw_iron', 'iron_ore']);
  const wood = countItems(inventory, ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']);
  const rate = successRate(memory, 'goal:ensureItem');

  if (world.pickaxeTier > 0 && world.pickaxeTier < 3) {
    const nextPickaxe = { 1: 'stone_pickaxe', 2: 'iron_pickaxe' }[world.pickaxeTier];
    if (nextPickaxe) {
      goals.push({
        skill: 'ensureItem',
        args: { item: nextPickaxe, count: 1 },
        reason: `Upgrade to a ${nextPickaxe.replace(/_/g, ' ')}`,
        priority: 42
      });
    }
  }
  if (torches < 4 && wood > 0) {
    goals.push({ skill: 'ensureItem', args: { item: 'torch', count: 8 }, reason: 'Stock light for caves and the base', priority: 38 });
  }
  if (iron < 6 && world.pickaxeTier >= 2) {
    goals.push({ skill: 'mine', args: { item: 'iron_ore', count: 8 }, reason: 'Build an iron reserve', priority: 36 });
  }
  if (world.food >= 14 && world.armorPieces < 4 && rate !== null && rate >= 0.5) {
    goals.push({
      skill: 'ensureItem',
      args: { item: 'iron_chestplate', count: 1 },
      reason: 'Cover an armor gap',
      priority: 34
    });
  }
  if (!world.threat && world.health > 14 && world.food > 8) {
    goals.push({ skill: 'farm', args: {}, reason: 'Tend crops while the area is calm', priority: 20 });
  }
  return goals;
}

function deliberate(instruction, { observation, memory, reasoner }) {
  if (!instruction || !reasoner) return null;
  const world = assess(observation, memory);
  let plan = reasoner.plan(instruction, { observation });
  if (!plan) return null;
  const thought = [`Read the request as "${plan.title}".`, describeWorld(world)];

  const risky = plan.steps.some(step => (RISK_BY_SKILL[step.skill] || 0) >= 0.3);
  if (world.threat) thought.push(`A ${world.threat.name} is ${world.threat.distance} blocks out, so I will not dig blindly.`);
  if (risky && world.health <= 10) thought.push('Health is too low for a long trip; I will keep this short and bail out early.');
  if (world.health <= 8 && world.threat && plan.goal?.kind !== 'night') {
    plan = {
      ...plan,
      steps: [{ skill: 'survive', args: {}, why: 'Survival first: low health with a hostile nearby.' }, ...plan.steps]
    };
    thought.push('Survival outranks the request, so I added a defensive step before the task.');
  }

  const risk = plan.steps.reduce((sum, step) => sum + (RISK_BY_SKILL[step.skill] || 0.05), 0) / plan.steps.length;
  const confidence = Math.max(0.25, Math.min(0.98, Number(plan.confidence || 0.6) * (1 - risk * 0.25)));
  thought.push(`Confidence ${Math.round(confidence * 100)}%; risk ${Math.round(risk * 100)}%.`);
  return { kind: 'plan', plan, needs: world.needs, thought, confidence, risk, createdAt: Date.now() };
}

function recommendAutonomy({ observation, memory, config, reasoner, autonomyGoal = 'auto' }) {
  const world = assess(observation, memory);
  const baseline = chooseGoal(observation, memory, { config, goal: autonomyGoal });
  const candidates = [baseline, ...curiosityGoals(world, memory)];
  let best = baseline;
  let bestScore = -Infinity;
  for (const goal of candidates) {
    const score = scoreGoal(goal, world, memory);
    if (score > bestScore) {
      bestScore = score;
      best = goal;
    }
  }
  const thought = [describeWorld(world)];
  if (best !== baseline) {
    thought.push(`Instead of "${baseline.reason}", I am choosing "${best.reason}" because it is the stronger use of this calm window.`);
  } else {
    thought.push(`The urgent need is "${best.reason}".`);
  }
  if (world.needs.length > 1) {
    thought.push(`Other needs: ${world.needs.slice(1).map(need => need.kind).join(', ')}.`);
  }
  const risk = RISK_BY_SKILL[best.skill] || 0.1;
  const confidence = Math.max(0.3, Math.min(0.95, 0.7 - risk * 0.3 + (world.health / 20) * 0.2));
  return { kind: 'goal', goal: best, needs: world.needs, thought, confidence, risk, createdAt: Date.now() };
}

function diagnose(error) {
  const text = String(error?.message || error || '');
  if (HARM_ERROR.test(text)) return { kind: 'harm', lesson: 'Survival comes first: heal or retreat before retrying.' };
  if (ROUTE_ERROR.test(text)) return { kind: 'route', lesson: 'The route is blocked; change area or shorten the goal.' };
  if (MISSING_ERROR.test(text)) return { kind: 'missing', lesson: 'A prerequisite was missing; satisfy it before repeating the plan.' };
  if (SEARCH_ERROR.test(text)) return { kind: 'search', lesson: 'The target was not present; scout a different area.' };
  return { kind: 'unknown', lesson: 'The approach failed; try a different tactic instead of repeating it.' };
}

function missingItemFrom(error) {
  const text = String(error?.message || error || '');
  const match = text.match(/No ([a-z_]+) in my inventory/i) ||
    text.match(/need (?:a |an |\d+ )?([a-z_]+)/i) ||
    text.match(/(?:could only obtain \d+) ([a-z_]+)/i);
  return match ? match[1] : null;
}

function replan(decision, error, { observation, memory, reasoner }) {
  const world = assess(observation, memory);
  const diagnosis = diagnose(error);
  if (world.health <= 8 || diagnosis.kind === 'harm') {
    const goal = world.threat
      ? { skill: 'survive', args: {}, reason: 'Retreat and recover before anything else' }
      : { skill: 'eat', args: {}, reason: 'Heal before retrying' };
    return { kind: 'goal', goal, thought: [`Diagnosis: ${diagnosis.lesson}`, 'Switching to recovery.'], diagnosis };
  }
  if (diagnosis.kind === 'missing') {
    const item = missingItemFrom(error);
    if (item) {
      return {
        kind: 'goal',
        goal: { skill: 'ensureItem', args: { item, count: 1 }, reason: `Obtain ${item.replace(/_/g, ' ')} first` },
        thought: [`Diagnosis: ${diagnosis.lesson}`, `I will obtain ${item.replace(/_/g, ' ')} first.`],
        diagnosis
      };
    }
  }
  if (diagnosis.kind === 'route' || diagnosis.kind === 'search') {
    const goal = { skill: 'explore', args: { radius: 24 }, reason: 'Scout a new area after the failed route' };
    return {
      kind: 'goal',
      goal,
      thought: [`Diagnosis: ${diagnosis.lesson}`, 'Exploring before retrying the same coordinates.'],
      diagnosis
    };
  }
  return null;
}

function reflect(decision, { result = null, error = null, memory = null } = {}) {
  if (!decision) return null;
  const ok = !error;
  const lesson = ok
    ? `${decision.kind === 'goal' ? decision.goal?.reason : decision.plan?.title} worked; repeat it when the same need appears.`
    : diagnose(error).lesson;
  if (memory?.setFact) {
    memory.setFact('brain:lastLesson', {
      success: ok,
      lesson,
      goal: decision.kind === 'goal' ? decision.goal?.skill : decision.plan?.title,
      at: new Date().toISOString()
    });
  }
  return { success: ok, lesson };
}

function explain(decision, memory = null) {
  if (!decision) return 'I have not made a decision yet. Give me a task or let autonomous mode pick one.';
  const parts = [];
  if (decision.thought?.length) parts.push(decision.thought.join(' '));
  if (decision.kind === 'goal') parts.push(`Chosen action: ${decision.goal.reason}.`);
  if (decision.kind === 'plan') parts.push(`Plan: ${decision.plan.title}.`);
  parts.push(`Confidence ${Math.round((decision.confidence || 0) * 100)}%.`);
  const stored = memory?.getFact?.('brain:lastLesson');
  if (stored?.lesson) parts.push(`Last lesson: ${stored.lesson}`);
  return parts.join(' ');
}

function describe({ observation, memory }) {
  const world = assess(observation, memory);
  const lines = [
    describeWorld(world),
    world.needs.length
      ? `Needs in order: ${world.needs.map(need => `${need.kind}(${need.urgency})`).join(', ')}.`
      : 'No urgent needs; curiosity and upkeep drive the next choice.'
  ];
  const rated = (memory?.getSkills?.() || [])
    .filter(skill => skill.attempts > 0)
    .sort((left, right) => right.attempts - left.attempts)
    .slice(0, 5)
    .map(skill => `${skill.name} ${skill.successes}/${skill.attempts}`);
  if (rated.length) lines.push(`Learned reliability: ${rated.join(', ')}.`);
  const stored = memory?.getFact?.('brain:lastLesson');
  if (stored?.lesson) lines.push(`Last lesson: ${stored.lesson}`);
  return lines.join(' ');
}

function createCortex() {
  let lastDecision = null;
  let lastReflection = null;
  return {
    assess,
    deliberate(instruction, options) {
      const decision = deliberate(instruction, options);
      if (decision) lastDecision = decision;
      return decision;
    },
    recommendAutonomy(options) {
      const decision = recommendAutonomy(options);
      if (decision) lastDecision = decision;
      return decision;
    },
    replan(decision, error, options) {
      return replan(decision, error, options);
    },
    reflect(decision, outcome) {
      const reflection = reflect(decision, outcome);
      if (reflection) lastReflection = reflection;
      return reflection;
    },
    explainLast(memory = null) {
      return explain(lastDecision, memory);
    },
    describe(options) {
      return describe(options);
    },
    get lastDecision() {
      return lastDecision;
    },
    get lastReflection() {
      return lastReflection;
    }
  };
}

let cachedCortex = null;

function getCortex() {
  if (!cachedCortex) cachedCortex = createCortex();
  return cachedCortex;
}

module.exports = {
  RISK_BY_SKILL,
  assess,
  createCortex,
  describe,
  diagnose,
  explain,
  getCortex,
  recommendAutonomy
};
