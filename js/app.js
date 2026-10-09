import { APP_CONFIG, PROCESSING_MODES } from '../config.js';
import { humanizeText, buildHumanizationOptions } from './humanizer.js';
import { checkMultipleDetectors } from './detectors.js';
import { setupComparison } from './compare.js';
import { validateText, compareTexts as analyzeTexts } from './text-analysis.js';
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
  updateInstructionsCount,
  applyTheme,
  setSelectedModeLabel,
  setLoading,
  setProcessingStatus,
  setResult,
  renderDetectorResults,
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
  originalBackup: '',
  resultText: '',
  instructions: '',
  processingStatus: 'empty',
  detectorStatus: 'idle',
  detectorResults: [],
  lastRequest: null,
  lastComparison: null,
  error: null,
  isProcessing: false,
  isChecking: false
};

const comparison = setupComparison();
let activeHumanizationController = null;

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
  state.preferences.instructions = state.instructions;
  savePreferences(state.preferences);
}

function setStateStatus(status, error = null) {
  state.processingStatus = status;
  state.error = error;
  setProcessingStatus(status, error?.message || '');
}

function updateInputState() {
  const validation = updateCounters(state.originalText, APP_CONFIG.textLimits);
  if (validation.code === 'EMPTY_TEXT') setStateStatus('empty');
  else if (!validation.valid) setStateStatus('error', { code: validation.code, message: validation.message });
  else setStateStatus('ready');
  return validation;
}

function restorePreferences() {
  const controls = getControls();
  applyTheme(state.preferences.theme);

  const writingMode = document.querySelector(`input[name="mode"][value="${state.preferences.mode}"]`)
    || document.querySelector('input[name="mode"][value="natural"]');
  writingMode.checked = true;
  state.preferences.mode = writingMode.value;
  setSelectedModeLabel(MODE_LABELS[writingMode.value]);

  const processingMode = document.querySelector(`input[name="processingMode"][value="${state.preferences.processingMode}"]`)
    || document.querySelector('input[name="processingMode"][value="instant"]');
  processingMode.checked = true;
  state.preferences.processingMode = processingMode.value;
  elements.processingModeDescription.textContent = PROCESSING_MODES[processingMode.value].description;

  controls.formality.value = state.preferences.formality;
  controls.creativity.value = state.preferences.creativity;
  controls.simplification.value = state.preferences.simplification;
  controls.preserveTerms.checked = Boolean(state.preferences.preserveTerms);
  controls.preserveParagraphs.checked = Boolean(state.preferences.preserveParagraphs);
  if ([...controls.language.options].some((option) => option.value === state.preferences.language)) {
    controls.language.value = state.preferences.language;
  } else {
    controls.language.value = 'pt-BR';
    state.preferences.language = 'pt-BR';
  }

  const length = document.querySelector(`input[name="length"][value="${state.preferences.length}"]`)
    || document.querySelector('input[name="length"][value="manter"]');
  length.checked = true;
  state.preferences.length = length.value;

  state.instructions = String(state.preferences.instructions || '').slice(0, 1000);
  elements.customInstructions.value = state.instructions;
  updateInstructionsCount(state.instructions);

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

  document.querySelectorAll('input[name="processingMode"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.preferences.processingMode = input.value;
      elements.processingModeDescription.textContent = PROCESSING_MODES[input.value].description;
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
  elements.customInstructions.addEventListener('input', () => {
    state.instructions = elements.customInstructions.value;
    updateInstructionsCount(state.instructions);
    persist();
  });
}

async function requestHumanization() {
  if (state.isProcessing) return;
  try {
    state.isProcessing = true;
    activeHumanizationController = new AbortController();
    setLoading(true);
    setStateStatus('processing');

    const options = {
      ...buildHumanizationOptions(state.preferences, state.instructions),
      limits: APP_CONFIG.textLimits,
      signal: activeHumanizationController.signal
    };
    const response = await humanizeText(state.originalText, options);
    state.lastRequest = response.request;

    if (response.status === 'error') {
      setStateStatus('error', response.error);
      showToast('Não foi possível continuar', response.error.message, 'error');
      elements.originalText.focus();
      return;
    }
    if (response.status === 'not_configured') {
      setStateStatus('not_configured', response.error);
      showToast('Configuração necessária', response.error.message, 'info', 6000);
      return;
    }
    if (response.status === 'cancelled') {
      setStateStatus('ready');
      showToast('Processamento cancelado', 'O texto original foi preservado.', 'info');
      return;
    }
    if (response.status === 'completed' && typeof response.output === 'string') {
      state.resultText = response.output;
      state.lastComparison = analyzeTexts(state.originalText, state.resultText);
      setStateStatus('completed');
      setResult(response.output);
    }
  } catch (error) {
    console.error(error);
    setStateStatus('error', { code: 'UNEXPECTED_ERROR', message: 'Ocorreu um erro inesperado.' });
    showToast('Não foi possível continuar', 'Ocorreu um erro inesperado. Tente novamente.', 'error');
  } finally {
    activeHumanizationController = null;
    state.isProcessing = false;
    setLoading(false);
  }
}

function cancelHumanization() {
  if (!state.isProcessing || !activeHumanizationController) return false;
  activeHumanizationController.abort('cancelled');
  return true;
}

async function requestDetectorCheck() {
  if (state.isChecking) return;
  const validation = validateText(state.originalText, APP_CONFIG.textLimits);
  if (!validation.valid) {
    showToast('Texto necessário', validation.message, 'error');
    elements.originalText.focus();
    return;
  }

  try {
    state.isChecking = true;
    state.detectorStatus = 'checking';
    elements.checkAIButton.setAttribute('aria-busy', 'true');
    const report = await checkMultipleDetectors(state.originalText, APP_CONFIG.detectors, { limits: APP_CONFIG.textLimits });
    state.detectorStatus = report.status;
    state.detectorResults = report.results;
    renderDetectorResults(report);
    elements.detectorDialog.showModal();
    showToast('Verificadores indisponíveis', 'As integrações estão preparadas, mas nenhum provedor foi conectado.', 'info');
  } catch (error) {
    console.error(error);
    state.detectorStatus = 'error';
    showToast('Falha na verificação', 'Não foi possível preparar os verificadores.', 'error');
  } finally {
    state.isChecking = false;
    elements.checkAIButton.setAttribute('aria-busy', 'false');
  }
}

function bindEditor() {
  elements.originalText.addEventListener('input', () => {
    state.originalText = elements.originalText.value;
    updateInputState();
  });

  elements.clearButton.addEventListener('click', () => {
    if (!state.originalText) return;
    state.originalBackup = state.originalText;
    state.originalText = '';
    elements.originalText.value = '';
    elements.restoreButton.disabled = false;
    updateInputState();
    elements.originalText.focus();
    showToast('Campo limpo', 'Use Restaurar para recuperar o texto removido.', 'success', 3200);
  });

  elements.restoreButton.addEventListener('click', () => {
    if (!state.originalBackup) return;
    state.originalText = state.originalBackup;
    state.originalBackup = '';
    elements.originalText.value = state.originalText;
    elements.restoreButton.disabled = true;
    updateInputState();
    elements.originalText.focus();
    showToast('Texto restaurado', 'A última versão removida voltou ao editor.', 'success');
  });

  elements.copyOriginalButton.addEventListener('click', async () => {
    try {
      await copyToClipboard(state.originalText);
      showToast('Original copiado', 'O texto original foi enviado para a área de transferência.', 'success');
    } catch (error) {
      showToast('Não foi possível copiar', error.message, 'error');
    }
  });

  elements.checkAIButton.addEventListener('click', requestDetectorCheck);
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
    if (event.key === 'Escape' && state.isProcessing) {
      event.preventDefault();
      cancelHumanization();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      requestHumanization();
    }
  });
}

function bindDialogs() {
  const closeDialog = (dialog) => dialog.open && dialog.close();
  document.querySelector('#closeDetectorButton').addEventListener('click', () => closeDialog(elements.detectorDialog));
  document.querySelector('#closeTipsButton').addEventListener('click', () => closeDialog(elements.tipsDialog));
  document.querySelector('#tipsButton').addEventListener('click', () => elements.tipsDialog.showModal());
  [elements.detectorDialog, elements.tipsDialog].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
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
  bindDialogs();
  bindHeader();
  updateInputState();
  setResult('');

  window.AvatarApp = Object.freeze({
    getState: () => structuredClone(state),
    getConfiguration: () => structuredClone(APP_CONFIG),
    cancelHumanization,
    setHumanizedText: (text) => {
      if (typeof text !== 'string' || !text.trim()) throw new TypeError('O resultado deve ser um texto não vazio.');
      state.resultText = text.normalize('NFC');
      state.lastComparison = analyzeTexts(state.originalText, state.resultText);
      setStateStatus('completed');
      setResult(state.resultText);
    },
    resetPreferences: () => {
      state.preferences = { ...DEFAULT_PREFERENCES };
      state.instructions = '';
      restorePreferences();
      persist();
    }
  });
}

initialize();
