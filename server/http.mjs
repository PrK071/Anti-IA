import { randomUUID } from 'node:crypto';

export function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders
    }
  });
}

export function errorResponse(status, requestId, code, message, extraHeaders) {
  return jsonResponse(status, { status: 'error', requestId, error: { code, message } }, extraHeaders);
}

export function getRequestId(request) {
  const supplied = request.headers.get('x-request-id') || '';
  return /^[a-zA-Z0-9-]{8,80}$/.test(supplied) ? supplied : randomUUID();
}

export function getClientId(request) {
  return (request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown')
    .split(',')[0].trim().slice(0, 80);
}

export function isSameOriginRequest(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLocaleLowerCase();
    const requestHost = new URL(request.url).host.toLocaleLowerCase();
    const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0].trim().toLocaleLowerCase();
    return originHost === requestHost || (forwardedHost && originHost === forwardedHost);
  } catch {
    return false;
  }
}

export async function parseRequestBody(request, requestId) {
  const maxBodyBytes = 256_000;
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return { response: errorResponse(413, requestId, 'REQUEST_TOO_LARGE', 'A solicitação excede o tamanho permitido.') };
  }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > maxBodyBytes) {
      return { response: errorResponse(413, requestId, 'REQUEST_TOO_LARGE', 'A solicitação excede o tamanho permitido.') };
    }
    return { payload: JSON.parse(raw) };
  } catch {
    return { response: errorResponse(400, requestId, 'INVALID_JSON', 'Envie um corpo JSON válido.') };
  }
}

export function providerErrorResponse(status, requestId, retryAfter) {
  if (status === 401 || status === 403) {
    return errorResponse(502, requestId, 'PROVIDER_AUTH_ERROR', 'O serviço de IA está temporariamente indisponível por uma falha de configuração.');
  }
  if (status === 402) {
    return errorResponse(503, requestId, 'PROVIDER_CREDITS_EXHAUSTED', 'O serviço de IA está temporariamente sem créditos disponíveis.');
  }
  if (status === 429) {
    return errorResponse(429, requestId, 'PROVIDER_RATE_LIMITED', 'O serviço de IA atingiu seu limite temporário. Aguarde e tente novamente.', retryAfter ? { 'Retry-After': retryAfter } : undefined);
  }
  if (status >= 500) {
    return errorResponse(503, requestId, 'PROVIDER_UNAVAILABLE', 'O serviço de IA está temporariamente indisponível. Tente novamente em instantes.');
  }
  return errorResponse(502, requestId, 'PROVIDER_ERROR', 'O serviço de IA não conseguiu processar a solicitação.');
}
