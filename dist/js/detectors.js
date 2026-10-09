import { APP_CONFIG } from '../config.js';
import { validateText } from './text-analysis.js';

export const DETECTOR_PROVIDERS = Object.freeze({
  gptzero: Object.freeze({ id: 'gptzero', name: 'GPTZero' }),
  copyleaks: Object.freeze({ id: 'copyleaks', name: 'Copyleaks' }),
  zerogpt: Object.freeze({ id: 'zerogpt', name: 'ZeroGPT' }),
  originality: Object.freeze({ id: 'originality', name: 'Originality.ai' })
});

function createResult(provider, status, overrides = {}) {
  const definition = DETECTOR_PROVIDERS[provider] || { id: provider, name: provider };
  return {
    provider: definition.id,
    name: definition.name,
    status,
    result: null,
    scale: null,
    methodology: null,
    analyzedAt: null,
    error: null,
    notes: [],
    ...overrides
  };
}

/** Um detector sempre preserva a escala original do provedor, sem normalização universal. */
export async function checkAI(text, provider, options = {}) {
  const validation = validateText(text, options.limits || APP_CONFIG.textLimits);
  if (!validation.valid) {
    return createResult(provider, 'error', { error: { code: validation.code, message: validation.message } });
  }
  if (!DETECTOR_PROVIDERS[provider]) {
    return createResult(provider, 'error', { error: { code: 'UNKNOWN_PROVIDER', message: 'Provedor de verificação desconhecido.' } });
  }
  return createResult(provider, 'not_configured', {
    error: { code: 'DETECTOR_NOT_CONFIGURED', message: 'Integração ainda não configurada.' },
    notes: ['Nenhum texto foi enviado a serviços externos.']
  });
}

export async function checkMultipleDetectors(text, providers = APP_CONFIG.detectors, options = {}) {
  const selected = [...new Set(providers)];
  const results = await Promise.all(selected.map((provider) => checkAI(text, provider, options)));
  const validation = validateText(text, options.limits || APP_CONFIG.textLimits);
  return {
    status: results.some((result) => result.status === 'error') ? 'error' : 'not_configured',
    analyzedAt: null,
    wordCount: validation.counts.words,
    results,
    disclaimer: 'Detectores de IA fornecem estimativas, não comprovação definitiva de autoria.'
  };
}
