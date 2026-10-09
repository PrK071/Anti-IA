import { APP_CONFIG, PROCESSING_MODES } from '../config.js';
import { validateText } from './text-analysis.js';

function createError(code, message) {
  return { code, message };
}

export function buildHumanizationOptions(preferences, instructions = '') {
  const processingMode = PROCESSING_MODES[preferences.processingMode] || PROCESSING_MODES.instant;
  return {
    processingMode: processingMode.id,
    processingProfile: {
      rewriteDepth: processingMode.rewriteDepth,
      semanticFidelity: processingMode.semanticFidelity,
      preserveStructure: processingMode.preserveStructure
    },
    writingMode: preferences.mode,
    language: preferences.language,
    instructions: String(instructions || '').trim(),
    adjustments: {
      formality: preferences.formality,
      creativity: preferences.creativity,
      simplification: preferences.simplification,
      length: preferences.length,
      preserveTerms: preferences.preserveTerms,
      preserveParagraphs: preferences.preserveParagraphs
    },
    safeguards: {
      preserveNames: true,
      preserveNumbers: true,
      preserveDates: true,
      preserveReferences: true,
      avoidFabrication: true
    }
  };
}

export function createHumanizePayload(text, options = {}) {
  return {
    text: String(text ?? '').normalize('NFC').trim(),
    options: structuredClone(options)
  };
}

export function validateHumanizationInput(text, limits = APP_CONFIG.textLimits) {
  return validateText(text, limits);
}

/**
 * Serviço do Humanizer 2.0. A futura chamada de IA deve ocorrer por um backend
 * seguro. Este módulo não substitui sinônimos, não chama terceiros e não cria saída.
 */
export async function humanizeText(text, options = {}) {
  const validation = validateHumanizationInput(text, options.limits || APP_CONFIG.textLimits);
  const request = createHumanizePayload(text, options);

  if (!validation.valid) {
    return {
      status: 'error', output: null, request, validation,
      error: createError(validation.code, validation.message)
    };
  }

  return {
    status: 'not_configured',
    output: null,
    request,
    validation,
    error: createError('AI_NOT_CONFIGURED', 'O motor de IA ainda não está conectado. Nenhum texto foi enviado ou gerado.')
  };
}
