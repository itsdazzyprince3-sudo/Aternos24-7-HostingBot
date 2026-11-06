'use strict';

const { MAX_MEMORY_NOTE_LENGTH } = require('./ai-memory');

function parseAIChatCommand(message) {
  if (typeof message !== 'string') return null;
  const match = message.trim().match(/^[!/]\s*ai(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  const input = (match[1] || '').trim();
  if (!input || /^help$/i.test(input)) return { type: 'help' };
  if (/^status$/i.test(input)) return { type: 'status' };
  if (/^stop$/i.test(input)) return { type: 'stop' };
  if (/^(?:pause|pause grind|pause grinding)$/i.test(input)) return { type: 'pause' };
  if (/^(?:resume|grind|resume grind|resume grinding)$/i.test(input)) return { type: 'resume' };
  if (/^recover$/i.test(input)) return { type: 'recover' };

  const teach = input.match(/^teach\s+([\s\S]+)$/i);
  if (teach) return { type: 'teach', text: teach[1].trim() };

  const task = input.replace(/^(?:ask|do|task)\s+/i, '').trim();
  return task ? { type: 'task', text: task } : { type: 'help' };
}

function isAIChatAuthorized(username, allowedUsers) {
  if (typeof username !== 'string' || !Array.isArray(allowedUsers)) return false;
  const normalizedUsername = username.trim().toLowerCase();
  return normalizedUsername.length > 0 && allowedUsers.some(user =>
    typeof user === 'string' && user.trim().toLowerCase() === normalizedUsername
  );
}

function createTrustedChatMemoryNote(username, message, allowedUsers) {
  if (!isAIChatAuthorized(username, allowedUsers) || typeof message !== 'string') return null;
  const text = message.trim();
  if (!text) return null;
  return `${username}: ${text}`.slice(0, MAX_MEMORY_NOTE_LENGTH);
}

module.exports = {
  createTrustedChatMemoryNote,
  isAIChatAuthorized,
  parseAIChatCommand
};
