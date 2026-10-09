/**
 * Contrato previsto para a futura integração segura.
 * A chamada de IA deverá acontecer em um servidor — nunca diretamente deste arquivo.
 */
export class HumanizerUnavailableError extends Error {
  constructor() {
    super('O motor de IA ainda não está conectado.');
    this.name = 'HumanizerUnavailableError';
    this.code = 'AI_NOT_CONFIGURED';
  }
}

export function createHumanizePayload(text, mode, settings) {
  return {
    text: text.trim(),
    mode,
    settings: { ...settings }
  };
}

export function validatePayload(payload) {
  if (!payload.text) {
    const error = new Error('Insira um texto antes de continuar.');
    error.code = 'EMPTY_TEXT';
    throw error;
  }
  if (payload.text.length > 50000) {
    const error = new Error('O texto excede o limite de 50.000 caracteres.');
    error.code = 'TEXT_TOO_LONG';
    throw error;
  }
}

export async function humanizeText(payload) {
  validatePayload(payload);

  // Integração futura:
  // 1. enviar payload a um endpoint seguro do servidor;
  // 2. validar a resposta;
  // 3. devolver somente o texto processado;
  // 4. normalizar erros de rede e de processamento.
  throw new HumanizerUnavailableError();
}
