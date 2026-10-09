const STORAGE_KEY = 'avatar.preferences.v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'dark',
  mode: 'natural',
  processingMode: 'instant',
  formality: 50,
  creativity: 50,
  simplification: 'media',
  length: 'manter',
  preserveTerms: true,
  preserveParagraphs: true,
  language: 'pt-BR',
  instructions: ''
});

export function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_PREFERENCES, ...stored };
  } catch (error) {
    console.warn('Não foi possível ler as preferências salvas.', error);
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch (error) {
    console.warn('Não foi possível salvar as preferências.', error);
    return false;
  }
}

export function getRangeLabel(type, value) {
  const index = Math.max(0, Math.min(4, Math.round(Number(value) / 25)));
  const labels = type === 'formality'
    ? ['Muito casual', 'Casual', 'Equilibrada', 'Formal', 'Muito formal']
    : ['Precisa', 'Contida', 'Moderada', 'Expressiva', 'Inventiva'];
  return labels[index];
}

export function applyRangeProgress(input) {
  const progress = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--range-progress', `${progress}%`);
}
