import { APP_CONFIG, PROCESSING_MODES } from '../config.js';
import { validateText } from './text-analysis.js';
import { processDocument, CHUNK_CHARACTERS, CHUNK_WORDS } from './long-document.js';

const HUMANIZE_ENDPOINT = '/api/humanize';
const CLIENT_TIMEOUT_MS = APP_CONFIG.requestTimeoutMs || 55_000;

function createError(code, message) {
  return { code, message };
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `avatar-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createAbortContext(externalSignal) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort('timeout'), CLIENT_TIMEOUT_MS);
  const abortFromExternal = () => controller.abort(externalSignal?.reason || 'cancelled');

  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal();
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      globalThis.clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  };
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function publicRequestOptions(options) {
  return {
    processingMode: options.processingMode,
    writingMode: options.writingMode,
    language: options.language,
    instructions: options.instructions,
    adjustments: options.adjustments,
    safeguards: options.safeguards
  };
}

export function buildHumanizationOptions(preferences, instructions = '') {
  const processingMode = PROCESSING_MODES[preferences.processingMode] || PROCESSING_MODES.instant;
  return {
    processingMode: processingMode.id,
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
    options: structuredClone(publicRequestOptions(options)),
    ...(options.context ? { context: options.context } : {})
  };
}

export function validateHumanizationInput(text, limits = APP_CONFIG.textLimits) {
  return validateText(text, limits);
}

/**
 * Envia o texto somente ao endpoint interno do AVATAR. A chave do provedor e a
 * chamada ao DeepSeek permanecem exclusivamente na função serverless.
 */
async function humanizeChunk(text, options = {}) {
  const validation = validateHumanizationInput(text, options.limits || APP_CONFIG.textLimits);
  const request = createHumanizePayload(text, options);

  if (!validation.valid) {
    return {
      status: 'error', output: null, request, validation,
      error: createError(validation.code, validation.message)
    };
  }

  const requestId = createRequestId();
  const abortContext = createAbortContext(options.signal);

  try {
    const response = await fetch(HUMANIZE_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Request-Id': requestId
      },
      body: JSON.stringify(request),
      signal: abortContext.signal,
      credentials: 'same-origin'
    });
    const body = await readJsonSafely(response);

    if (!response.ok) {
      const error = body?.error && typeof body.error.code === 'string' && typeof body.error.message === 'string'
        ? body.error
        : createError('HTTP_ERROR', 'O serviço de humanização não respondeu como esperado.');
      return {
        status: error.code === 'SERVICE_NOT_CONFIGURED' ? 'not_configured' : 'error',
        output: null,
        request,
        validation,
        requestId: body?.requestId || requestId,
        retryAfterMs: retryAfterMilliseconds(response.headers.get('retry-after')),
        error
      };
    }

    if (body?.status !== 'completed' || typeof body.output !== 'string' || !body.output.trim()) {
      return {
        status: 'error', output: null, request, validation, requestId,
        error: createError('INVALID_RESPONSE', 'O serviço retornou uma resposta inválida.')
      };
    }

    return {
      status: 'completed',
      output: body.output.normalize('NFC'),
      request,
      validation,
      requestId: body.requestId || requestId,
      model: body.model || null,
      usage: body.usage || null,
      error: null
    };
  } catch (error) {
    const wasAborted = error?.name === 'AbortError' || abortContext.signal.aborted;
    const timedOut = abortContext.signal.reason === 'timeout';
    return {
      status: wasAborted && !timedOut ? 'cancelled' : 'error',
      output: null,
      request,
      validation,
      requestId,
      error: createError(
        wasAborted ? (timedOut ? 'CLIENT_TIMEOUT' : 'REQUEST_CANCELLED') : 'NETWORK_ERROR',
        wasAborted
          ? (timedOut ? 'O processamento excedeu o tempo de espera. Tente novamente.' : 'O processamento foi cancelado.')
          : 'Não foi possível acessar o serviço de humanização. Verifique sua conexão e tente novamente.'
      )
    };
  } finally {
    abortContext.cleanup();
  }
}

function retryAfterMilliseconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds*1000 : Math.max(1000, Date.parse(value)-Date.now()) || null;
}

export async function humanizeText(text, options = {}) {
  const validation = validateHumanizationInput(text, options.limits || APP_CONFIG.textLimits);
  const request = createHumanizePayload(text, options);
  if (!validation.valid) return { status: 'error', output: null, request, validation,
    error: createError(validation.code, validation.message) };
  if (request.text.length <= CHUNK_CHARACTERS && validation.counts.words <= CHUNK_WORDS) return humanizeChunk(text, options);
  try {
    const response = await processDocument(request.text, options, humanizeChunk);
    return { ...response, request, validation };
  } catch (error) {
    return { status: 'error', output: null, request, validation,
      error: createError('DOCUMENT_PROCESSING_ERROR', error.message || 'Falha ao preparar o artigo.') };
  }
}
