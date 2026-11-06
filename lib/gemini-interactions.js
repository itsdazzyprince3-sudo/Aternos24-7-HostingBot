'use strict';

function isGeminiInteractionsEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.hostname === 'generativelanguage.googleapis.com' &&
      url.pathname.replace(/\/+$/, '').endsWith('/interactions');
  } catch {
    return false;
  }
}

function toGeminiTools(openAITools, enableGoogleSearch = false) {
  const tools = openAITools.map(tool => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters
  }));
  return enableGoogleSearch ? [{ type: 'google_search' }, ...tools] : tools;
}

function buildGeminiInteractionRequest({
  model,
  input,
  systemInstruction,
  previousInteractionId,
  openAITools,
  enableGoogleSearch = false
}) {
  const body = {
    model,
    input,
    system_instruction: systemInstruction,
    tools: toGeminiTools(openAITools, enableGoogleSearch),
    generation_config: { tool_choice: 'auto' }
  };
  if (previousInteractionId) body.previous_interaction_id = previousInteractionId;
  return body;
}

function parseGeminiInteraction(responseBody) {
  const interaction = responseBody?.interaction || responseBody;
  if (!interaction || typeof interaction !== 'object' || !Array.isArray(interaction.steps)) {
    throw new Error('Gemini Interactions API returned an invalid interaction response.');
  }

  const functionCalls = interaction.steps
    .filter(step => step?.type === 'function_call')
    .map(step => {
      if (typeof step.name !== 'string' || !step.name) {
        throw new Error('Gemini returned a function call without a function name.');
      }
      if (!step.id && !step.call_id) {
        throw new Error(`Gemini function call "${step.name}" did not include a call ID.`);
      }
      return {
        id: step.id || step.call_id,
        name: step.name,
        arguments: step.arguments
      };
    });
  const modelOutput = interaction.steps
    .find(step => step?.type === 'model_output' || step?.type === 'text');
  const contentParts = Array.isArray(modelOutput?.content) ? modelOutput.content : [];
  const text = [
    interaction.output_text,
    modelOutput?.text,
    ...contentParts.map(part => part?.text)
  ].find(value => typeof value === 'string' && value.trim()) || '';
  const citations = contentParts
    .flatMap(part => Array.isArray(part?.annotations) ? part.annotations : [])
    .filter(annotation => annotation?.type === 'url_citation' &&
      typeof annotation.url === 'string' &&
      typeof annotation.title === 'string')
    .map(annotation => ({ title: annotation.title, url: annotation.url }));

  return {
    id: interaction.id,
    status: interaction.status,
    functionCalls,
    text,
    citations
  };
}

function toGeminiFunctionResult(call, result) {
  return {
    type: 'function_result',
    call_id: call.id,
    name: call.name,
    result
  };
}

module.exports = {
  buildGeminiInteractionRequest,
  isGeminiInteractionsEndpoint,
  parseGeminiInteraction,
  toGeminiFunctionResult,
  toGeminiTools
};
