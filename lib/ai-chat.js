'use strict';

const { MAX_MEMORY_NOTE_LENGTH } = require('./ai-memory');

function parseAIChatCommand(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();

  // Support: !ai ..., /ai ..., !bot ..., virgo ..., @virgo ..., hey virgo ..., bot: ...
  const match = trimmed.match(/^(?:[!/]\s*(?:ai|bot)|(?:hey\s+)?virgo[,:]?|@virgo[,:]?|bot[,:]?)\s*([\s\S]*)$/i) ||
    trimmed.match(/^[!/]\s*ai(?:\s+([\s\S]*))?$/i);
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
  return normalizedUsername.length > 0 && (
    allowedUsers.includes('*') ||
    allowedUsers.some(user => typeof user === 'string' && user.trim().toLowerCase() === normalizedUsername)
  );
}

function shouldAutoRespondToChat(username, aiConfig) {
  if (aiConfig?.enabled !== true) return false;
  // If respondToChat or respondToTrustedChat is enabled, auto-respond to chat
  if (aiConfig.respondToChat === true || aiConfig.respondToTrustedChat === true) {
    return isAIChatAuthorized(username, aiConfig.allowedUsers);
  }
  return false;
}

function getAIChatAllowedUsers(aiConfig, chatConfig) {
  const configuredUsers = [
    ...(Array.isArray(aiConfig?.allowedUsers) ? aiConfig.allowedUsers : []),
    ...(Array.isArray(chatConfig?.tpWhitelist) ? chatConfig.tpWhitelist : [])
  ];
  return [...new Set(configuredUsers
    .filter(user => typeof user === 'string')
    .map(user => user.trim())
    .filter(Boolean)
    .map(user => user.toLowerCase()))];
}

function createTrustedChatMemoryNote(username, message, allowedUsers) {
  if (!isAIChatAuthorized(username, allowedUsers) || typeof message !== 'string') return null;
  const text = message.trim();
  if (!text) return null;
  return `${username}: ${text}`.slice(0, MAX_MEMORY_NOTE_LENGTH);
}

module.exports = {
  createTrustedChatMemoryNote,
  getAIChatAllowedUsers,
  isAIChatAuthorized,
  parseAIChatCommand,
  shouldAutoRespondToChat
};
