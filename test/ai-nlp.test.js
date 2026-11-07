'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { detectLanguage, parseMultilingualIntent, reply } = require('../lib/ai-nlp');
const { parseLocalIntent } = require('../lib/ai-brain');

test('detects languages by script', () => {
  assert.strictEqual(detectLanguage('नमस्ते'), 'hi');
  assert.strictEqual(detectLanguage('হ্যালো'), 'bn');
  assert.strictEqual(detectLanguage('Привет'), 'ru');
  assert.strictEqual(detectLanguage('Привіт'), 'uk');
  assert.strictEqual(detectLanguage('مرحبا'), 'ar');
  assert.strictEqual(detectLanguage('کیا حال ہے'), 'ur');
  assert.strictEqual(detectLanguage('你好'), 'zh');
  assert.strictEqual(detectLanguage('こんにちは'), 'ja');
  assert.strictEqual(detectLanguage('안녕하세요'), 'ko');
  assert.strictEqual(detectLanguage('வணக்கம்'), 'ta');
});

test('detects Latin-script languages', () => {
  assert.strictEqual(detectLanguage('hola amigo como estas'), 'es');
  assert.strictEqual(detectLanguage('bonjour je veux de aide'), 'fr');
  assert.strictEqual(detectLanguage('hallo ich brauche hilfe'), 'de');
  assert.strictEqual(detectLanguage('ola eu preciso de ajuda'), 'pt');
  assert.strictEqual(detectLanguage('ciao come stai amico'), 'it');
  assert.strictEqual(detectLanguage('merhaba nasil gidiyor'), 'tr');
  assert.strictEqual(detectLanguage('halo saya butuh bantuan'), 'id');
  assert.strictEqual(detectLanguage('aaja bhai jaldi'), 'hi-Latn');
  assert.strictEqual(detectLanguage('mere piche aao'), 'hi-Latn');
  assert.strictEqual(detectLanguage('hello there friend'), 'en');
});

test('recognizes multilingual commands', () => {
  assert.deepStrictEqual(
    (({ type, intent }) => ({ type, intent }))(parseMultilingualIntent('hola')),
    { type: 'chat', intent: 'greeting' }
  );
  assert.strictEqual(parseMultilingualIntent('gracias').intent, 'thanks');
  assert.strictEqual(parseMultilingualIntent('ruko').type, 'stop');
  assert.strictEqual(parseMultilingualIntent('bas karo').type, 'stop');
  assert.strictEqual(parseMultilingualIntent('aaja').type, 'come');
  assert.strictEqual(parseMultilingualIntent('mere piche aao').type, 'follow');
  assert.strictEqual(parseMultilingualIntent('ven aquí').type, 'come');
  assert.strictEqual(parseMultilingualIntent('sígueme').type, 'follow');
  assert.strictEqual(parseMultilingualIntent('komm her').type, 'come');
  assert.strictEqual(parseMultilingualIntent('idi za mnoy').type, 'follow');
  assert.strictEqual(parseMultilingualIntent('你好').intent, 'greeting');
  assert.strictEqual(parseMultilingualIntent('привет').intent, 'greeting');
  assert.strictEqual(parseMultilingualIntent('random english sentence'), null);
});

test('local brain parses multilingual commands with language attached', () => {
  const come = parseLocalIntent('aaja');
  assert.strictEqual(come.type, 'come');
  assert.strictEqual(come.lang, 'hi-Latn');

  const follow = parseLocalIntent('mere piche aao');
  assert.strictEqual(follow.type, 'follow');

  const stop = parseLocalIntent('ruko');
  assert.strictEqual(stop.type, 'stop');

  const greeting = parseLocalIntent('hola');
  assert.strictEqual(greeting.type, 'chat');
  assert.strictEqual(greeting.intent, 'greeting');
  assert.strictEqual(greeting.lang, 'es');
});

test('localized replies answer in the detected language', () => {
  assert.match(reply('greeting', 'es'), /Hola/);
  assert.match(reply('greeting', 'hi-Latn'), /Namaste/);
  assert.match(reply('greeting', 'hi'), /नमस्ते/);
  assert.match(reply('thanks', 'fr'), /De rien/);
  assert.match(reply('greeting', 'zh'), /你好/);
  assert.match(reply('greeting', 'ja'), /こんにちは/);
  assert.match(reply('greeting', 'ar'), /مرحباً/);
  assert.strictEqual(reply('greeting', 'xx'), reply('greeting', 'en'));
  assert.match(reply('fallback', 'es', { pos: '10, 64, -5', health: 18 }), /10, 64, -5.*18\/20/);
});
