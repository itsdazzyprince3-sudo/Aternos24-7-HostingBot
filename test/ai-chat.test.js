'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_MEMORY_NOTE_LENGTH } = require('../lib/ai-memory');
const {
  createTrustedChatMemoryNote,
  isAIChatAuthorized,
  parseAIChatCommand
} = require('../lib/ai-chat');

test('AI chat command parser accepts slash and chat-prefix forms', () => {
  assert.deepEqual(parseAIChatCommand('!ai mine stone'), { type: 'task', text: 'mine stone' });
  assert.deepEqual(parseAIChatCommand('/ai ask what is nearby?'), { type: 'task', text: 'what is nearby?' });
  assert.deepEqual(parseAIChatCommand('!ai teach keep three logs'), {
    type: 'teach',
    text: 'keep three logs'
  });
  assert.deepEqual(parseAIChatCommand('/ai stop'), { type: 'stop' });
  assert.deepEqual(parseAIChatCommand('!ai pause'), { type: 'pause' });
  assert.deepEqual(parseAIChatCommand('/ai pause grinding'), { type: 'pause' });
  assert.deepEqual(parseAIChatCommand('!ai resume'), { type: 'resume' });
  assert.deepEqual(parseAIChatCommand('/ai resume grinding'), { type: 'resume' });
  assert.deepEqual(parseAIChatCommand('!ai'), { type: 'help' });
  assert.equal(parseAIChatCommand('hello Virgo'), null);
});

test('AI chat authorization matches configured usernames without case sensitivity', () => {
  assert.equal(isAIChatAuthorized('Virgo', ['virgo']), true);
  assert.equal(isAIChatAuthorized('OtherPlayer', ['virgo']), false);
  assert.equal(isAIChatAuthorized('Virgo', null), false);
});

test('trusted chat memory includes only allowlisted players and bounds note length', () => {
  assert.equal(
    createTrustedChatMemoryNote('virgo', '  I prefer oak tools.  ', ['Virgo']),
    'virgo: I prefer oak tools.'
  );
  assert.equal(createTrustedChatMemoryNote('stranger', 'hello', ['Virgo']), null);
  assert.equal(createTrustedChatMemoryNote('Virgo', ' '.repeat(5), ['Virgo']), null);
  assert.equal(
    createTrustedChatMemoryNote('Virgo', 'x'.repeat(500), ['Virgo']).length,
    MAX_MEMORY_NOTE_LENGTH
  );
});
