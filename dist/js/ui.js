export const elements = {
  originalText: document.querySelector('#originalText'),
  resultText: document.querySelector('#resultText'),
  emptyState: document.querySelector('#emptyState'),
  outputContent: document.querySelector('#outputContent'),
  wordCount: document.querySelector('#wordCount'),
  characterCount: document.querySelector('#characterCount'),
  clearButton: document.querySelector('#clearButton'),
  copyButton: document.querySelector('#copyButton'),
  downloadButton: document.querySelector('#downloadButton'),
  compareButton: document.querySelector('#compareButton'),
  humanizeButton: document.querySelector('#humanizeButton'),
  themeToggle: document.querySelector('#themeToggle'),
  settingsButton: document.querySelector('#settingsButton'),
  advancedSettings: document.querySelector('#advancedSettings'),
  selectedModeLabel: document.querySelector('#selectedModeLabel'),
  resultStats: document.querySelector('#resultStats'),
  toastRegion: document.querySelector('#toastRegion')
};

export function countText(text) {
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/u).length : 0,
    characters: text.length
  };
}

export function updateCounters(text) {
  const { words, characters } = countText(text);
  elements.wordCount.textContent = words.toLocaleString('pt-BR');
  elements.characterCount.textContent = characters.toLocaleString('pt-BR');
  elements.clearButton.disabled = characters === 0;
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
  elements.humanizeButton.querySelector('.button-label').textContent = isLoading ? 'Preparando…' : 'Humanizar texto';
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
  } else {
    elements.resultStats.textContent = 'Nenhum processamento realizado';
  }
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
