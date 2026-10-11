import { validateDetectionText, validDetectionReport } from './detection-report.js';
import { APP_CONFIG } from '../config.js';

export async function analyzeAuthorship(text, { limits, signal } = {}) {
  const validation = validateDetectionText(text, limits);
  if (!validation.valid) return { status: 'error', error: { code: validation.code, message: validation.message } };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), APP_CONFIG.requestTimeoutMs || 55_000);
  const abort = () => controller.abort('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetch('/api/detect', {
      method: 'POST', credentials: 'same-origin', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    let report;
    try { report = await response.json(); } catch { report = null; }
    if (!response.ok) {
      const error = typeof report?.error?.code === 'string' && typeof report?.error?.message === 'string'
        ? report.error
        : { code: 'SERVICE_UNAVAILABLE', message: response.status === 404
          ? 'O servidor de análise não está disponível. Abra o projeto com npm run dev ou publique o endpoint /api/detect.'
          : 'O serviço de análise não respondeu como esperado.' };
      return { status: error.code === 'DETECTOR_NOT_CONFIGURED' ? 'not_configured' : 'error', error };
    }
    if (!validDetectionReport(report, text)) return { status: 'error', error: { code: 'INVALID_RESPONSE', message: 'A análise recebida é inválida. Tente novamente.' } };
    return report;
  } catch {
    return controller.signal.aborted && controller.signal.reason !== 'timeout'
      ? { status: 'cancelled' }
      : { status: 'error', error: { code: controller.signal.aborted ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR', message: controller.signal.aborted
        ? 'A análise excedeu o tempo de espera. Tente novamente.'
        : 'Não foi possível acessar a análise. Verifique sua conexão e tente novamente.' } };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
