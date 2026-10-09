import { humanizeText, createHumanizePayload } from './humanizer.js';
import { setupComparison } from './compare.js';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  getRangeLabel,
  applyRangeProgress
} from './settings.js';
import {
  elements,
  updateCounters,
  applyTheme,
  setSelectedModeLabel,
  setLoading,
  setResult,
  showToast,
  copyToClipboard,
  downloadText
} from './ui.js';

const MODE_LABELS = {
  natural: 'Natural',
  academico: 'Acadêmico',
  profissional: 'Profissional',
  casual: 'Casual',
  criativo: 'Criativo',
  simplificado: 'Simplificado'
};

const state = {
  preferences: loadPreferences(),
  originalText: '',
  resultText: '',
  isProcessing: false
};

const comparison = setupComparison();

function getControls() {
  return {
    formality: document.querySelector('#formality'),
    creativity: document.querySelector('#creativity'),
    simplification: document.querySelector('#simplification'),
    preserveTerms: document.querySelector('#preserveTerms'),
    preserveParagraphs: document.querySelector('#preserveParagraphs'),
    language: document.querySelector('#language')
  };
}

function persist() {
  savePreferences(state.preferences);
}

function restorePreferences() {
  const controls = getControls();
  applyTheme(state.preferences.theme);

  const mode = document.querySelector(`input[name="mode"][value="${state.preferences.mode}"]`)
    || document.querySelector('input[name="mode"][value="natural"]');
  mode.checked = true;
  state.preferences.mode = mode.value;
  setSelectedModeLabel(MODE_LABELS[mode.value]);

  controls.formality.value = state.preferences.formality;
  controls.creativity.value = state.preferences.creativity;
  controls.simplification.value = state.preferences.simplification;
  controls.preserveTerms.checked = Boolean(state.preferences.preserveTerms);
  controls.preserveParagraphs.checked = Boolean(state.preferences.preserveParagraphs);
  controls.language.value = state.preferences.language;

  const length = document.querySelector(`input[name="length"][value="${state.preferences.length}"]`)
    || document.querySelector('input[name="length"][value="manter"]');
  length.checked = true;
  state.preferences.length = length.value;

  ['formality', 'creativity'].forEach((type) => {
    applyRangeProgress(controls[type]);
    document.querySelector(`#${type}Value`).textContent = getRangeLabel(type, controls[type].value);
  });
}

function bindPreferenceControls() {
  const controls = getControls();

  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.preferences.mode = input.value;
      setSelectedModeLabel(MODE_LABELS[input.value]);
      persist();
    });
  });

  ['formality', 'creativity'].forEach((type) => {
    controls[type].addEventListener('input', () => {
      state.preferences[type] = Number(controls[type].value);
      applyRangeProgress(controls[type]);
      document.querySelector(`#${type}Value`).textContent = getRangeLabel(type, controls[type].value);
      persist();
    });
  });

  controls.simplification.addEventListener('change', () => {
    state.preferences.simplification = controls.simplification.value;
    persist();
  });
  controls.preserveTerms.addEventListener('change', () => {
    state.preferences.preserveTerms = controls.preserveTerms.checked;
    persist();
  });
  controls.preserveParagraphs.addEventListener('change', () => {
    state.preferences.preserveParagraphs = controls.preserveParagraphs.checked;
    persist();
  });
  controls.language.addEventListener('change', () => {
    state.preferences.language = controls.language.value;
    persist();
  });
  document.querySelectorAll('input[name="length"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.preferences.length = input.value;
      persist();
    });
  });
}

async function requestHumanization() {
  if (state.isProcessing) return;

  const payload = createHumanizePayload(
    state.originalText,
    state.preferences.mode,
    {
      formality: state.preferences.formality,
      creativity: state.preferences.creativity,
      simplification: state.preferences.simplification,
      length: state.preferences.length,
      preserveTerms: state.preferences.preserveTerms,
      preserveParagraphs: state.preferences.preserveParagraphs,
      language: state.preferences.language
    }
  );

  try {
    state.isProcessing = true;
    setLoading(true);
    const result = await humanizeText(payload);
    state.resultText = result;
    setResult(result);
  } catch (error) {
    if (error.code === 'EMPTY_TEXT') {
      showToast('Texto necessário', error.message, 'error');
      elements.originalText.focus();
    } else if (error.code === 'AI_NOT_CONFIGURED') {
      showToast('Integração em preparação', 'O motor de IA ainda não está conectado. Nenhum texto foi gerado ou enviado.', 'info', 6000);
    } else {
      console.error(error);
      showToast('Não foi possível continuar', 'Ocorreu um erro inesperado. Tente novamente.', 'error');
    }
  } finally {
    state.isProcessing = false;
    setLoading(false);
  }
}

function bindEditor() {
  elements.originalText.addEventListener('input', () => {
    state.originalText = elements.originalText.value;
    updateCounters(state.originalText);
  });

  elements.clearButton.addEventListener('click', () => {
    if (!state.originalText) return;
    state.originalText = '';
    elements.originalText.value = '';
    updateCounters('');
    elements.originalText.focus();
    showToast('Campo limpo', 'O texto original foi removido.', 'success', 2600);
  });

  elements.humanizeButton.addEventListener('click', requestHumanization);

  elements.copyButton.addEventListener('click', async () => {
    try {
      await copyToClipboard(state.resultText);
      showToast('Texto copiado', 'O resultado foi enviado para a área de transferência.', 'success');
    } catch (error) {
      showToast('Não foi possível copiar', error.message, 'error');
    }
  });

  elements.downloadButton.addEventListener('click', () => {
    try {
      downloadText(state.resultText);
      showToast('Download iniciado', 'O arquivo TXT está sendo preparado.', 'success');
    } catch (error) {
      showToast('Não foi possível baixar', error.message, 'error');
    }
  });

  elements.compareButton.addEventListener('click', () => {
    if (!comparison.open(state.originalText, state.resultText)) {
      showToast('Comparação indisponível', 'São necessárias as versões original e humanizada.', 'error');
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      requestHumanization();
    }
  });
}

function bindHeader() {
  elements.themeToggle.addEventListener('click', () => {
    state.preferences.theme = state.preferences.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.preferences.theme);
    persist();
  });

  elements.settingsButton.addEventListener('click', () => {
    elements.advancedSettings.open = true;
    elements.advancedSettings.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => document.querySelector('#formality').focus({ preventScroll: true }), 350);
  });
}

function initialize() {
  restorePreferences();
  bindPreferenceControls();
  bindEditor();
  bindHeader();
  updateCounters('');
  setResult('');

  // Ponto de integração controlado para a futura camada de API.
  window.AvatarApp = Object.freeze({
    getState: () => structuredClone(state),
    setHumanizedText: (text) => {
      if (typeof text !== 'string') throw new TypeError('O resultado deve ser uma string.');
      state.resultText = text;
      setResult(text);
    },
    resetPreferences: () => {
      state.preferences = { ...DEFAULT_PREFERENCES };
      restorePreferences();
      persist();
    }
  });
}

initialize();
