import { APP_CONFIG } from '../config.js';
import { countText as analyzeCount, validateText } from './text-analysis.js';

export const elements = {
  originalText: document.querySelector('#originalText'),
  resultText: document.querySelector('#resultText'),
  emptyState: document.querySelector('#emptyState'),
  outputContent: document.querySelector('#outputContent'),
  wordCount: document.querySelector('#wordCount'),
  characterCount: document.querySelector('#characterCount'),
  limitIndicator: document.querySelector('#limitIndicator'),
  clearButton: document.querySelector('#clearButton'),
  restoreButton: document.querySelector('#restoreButton'),
  copyOriginalButton: document.querySelector('#copyOriginalButton'),
  checkAIButton: document.querySelector('#checkAIButton'),
  copyButton: document.querySelector('#copyButton'),
  downloadButton: document.querySelector('#downloadButton'),
  compareButton: document.querySelector('#compareButton'),
  humanizeButton: document.querySelector('#humanizeButton'),
  themeToggle: document.querySelector('#themeToggle'),
  settingsButton: document.querySelector('#settingsButton'),
  advancedSettings: document.querySelector('#advancedSettings'),
  selectedModeLabel: document.querySelector('#selectedModeLabel'),
  resultStats: document.querySelector('#resultStats'),
  customInstructions: document.querySelector('#customInstructions'),
  instructionsCount: document.querySelector('#instructionsCount'),
  processingModeDescription: document.querySelector('#processingModeDescription'),
  detectorDialog: document.querySelector('#detectorDialog'),
  detectorResults: document.querySelector('#detectorResults'),
  tipsDialog: document.querySelector('#tipsDialog'),
  toastRegion: document.querySelector('#toastRegion')
};

export const countText = analyzeCount;

export function updateCounters(text, limits = APP_CONFIG.textLimits) {
  const validation = validateText(text, limits);
  const { words, characters } = validation.counts;
  elements.wordCount.textContent = words.toLocaleString('pt-BR');
  elements.characterCount.textContent = characters.toLocaleString('pt-BR');
  elements.clearButton.disabled = characters === 0;
  elements.copyOriginalButton.disabled = characters === 0;

  elements.limitIndicator.classList.remove('is-warning', 'is-error');
  if (!validation.valid && validation.code !== 'EMPTY_TEXT') {
    elements.limitIndicator.classList.add('is-error');
    elements.limitIndicator.textContent = validation.message;
  } else if (validation.warnings.length) {
    elements.limitIndicator.classList.add('is-warning');
    elements.limitIndicator.textContent = validation.warnings[0];
  } else if (Number.isFinite(limits.maxWords)) {
    elements.limitIndicator.textContent = `máx. ${limits.maxWords.toLocaleString('pt-BR')} palavras`;
  } else {
    elements.limitIndicator.textContent = `limite técnico: ${limits.maxCharacters.toLocaleString('pt-BR')} caracteres`;
  }
  return validation;
}

export function updateInstructionsCount(text) {
  elements.instructionsCount.textContent = `${text.length.toLocaleString('pt-BR')}/1.000`;
}

export function applyTheme(theme) {
  const safeTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = safeTheme;
  elements.themeToggle.setAttribute('aria-label', safeTheme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
  document.querySelector('meta[name="theme-color"]').content = safeTheme === 'dark' ? '#09090b' : '#f4f2f8';
}

export function setSelectedModeLabel(label) {
  elements.selectedModeLabel.textContent = `${label} selecionado`;
}

export function setLoading(isLoading) {
  elements.humanizeButton.classList.toggle('is-loading', isLoading);
  elements.humanizeButton.disabled = isLoading;
  elements.humanizeButton.setAttribute('aria-busy', String(isLoading));
  elements.humanizeButton.querySelector('.button-label').textContent = isLoading ? 'Processando…' : 'Humanizar texto';
}

export function setProcessingStatus(status, detail = '') {
  elements.resultStats.dataset.status = status;
  const labels = {
    empty: 'Nenhum processamento realizado',
    ready: 'Texto pronto para processar',
    processing: 'Processando…',
    completed: 'Processamento concluído',
    error: detail || 'Erro no processamento',
    not_configured: 'Serviço de IA não configurado'
  };
  elements.resultStats.textContent = labels[status] || detail || status;
}

export function setResult(text) {
  const hasResult = Boolean(text && text.trim());
  elements.resultText.textContent = hasResult ? text : '';
  elements.resultText.hidden = !hasResult;
  elements.emptyState.hidden = hasResult;
  elements.copyButton.disabled = !hasResult;
  elements.downloadButton.disabled = !hasResult;
  elements.compareButton.disabled = !hasResult;

  if (hasResult) {
    const stats = countText(text);
    elements.resultStats.textContent = `${stats.words.toLocaleString('pt-BR')} palavras • ${stats.characters.toLocaleString('pt-BR')} caracteres`;
    elements.resultStats.dataset.status = 'completed';
  } else {
    setProcessingStatus('empty');
  }
}

export function renderDetectorResults(report) {
  elements.detectorResults.replaceChildren();
  report.results.forEach((result) => {
    const row = document.createElement('article');
    row.className = 'detector-row';

    const name = document.createElement('h3');
    name.textContent = result.name;
    const status = document.createElement('span');
    status.className = 'detector-status';
    status.textContent = result.status === 'not_configured' ? 'Indisponível' : 'Erro';
    const message = document.createElement('p');
    message.textContent = result.error?.message || 'Nenhum resultado recebido.';
    const time = document.createElement('time');
    time.textContent = result.analyzedAt ? new Date(result.analyzedAt).toLocaleString('pt-BR') : 'Sem análise';
    row.append(name, status, message, time);
    elements.detectorResults.append(row);
  });
}

export function showToast(title, message, type = 'info', duration = 4600) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.type = type;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const symbols = { info: 'i', error: '!', success: '✓' };
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${symbols[type] || 'i'}</span>
    <span class="toast-message"><strong></strong><span></span></span>
    <button class="toast-close" type="button" aria-label="Fechar notificação">×</button>`;
  toast.querySelector('strong').textContent = title;
  toast.querySelector('.toast-message span').textContent = message;
  const remove = () => {
    if (!toast.isConnected) return;
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 240);
  };
  toast.querySelector('.toast-close').addEventListener('click', remove);
  elements.toastRegion.append(toast);
  window.setTimeout(remove, duration);
}

export async function copyToClipboard(text) {
  if (!text) throw new Error('Não há conteúdo para copiar.');
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.append(fallback);
  fallback.select();
  const successful = document.execCommand('copy');
  fallback.remove();
  if (!successful) throw new Error('A cópia foi bloqueada pelo navegador.');
}

export function downloadText(text, filename = 'avatar-texto-humanizado.txt') {
  if (!text) throw new Error('Não há conteúdo para baixar.');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
