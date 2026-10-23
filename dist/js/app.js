import { APP_CONFIG, PROCESSING_MODES } from '../config.js';
import { humanizeText, buildHumanizationOptions } from './humanizer.js';
import { createCheckpointStore } from './long-document.js';
import { analyzeAuthorship } from './detectors.js';
import { validateDetectionText } from './detection-report.js';
import { setupComparison } from './compare.js';
import { bindDocumentImport } from './document-import.js';
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
  renderDetectorLoading,
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
  resultOriginalText: '',
  instructions: '',
  processingStatus: 'empty',
  detectorStatus: 'idle',
  detectorReport: null,
  detectorOriginalText: '',
  lastRequest: null,
  lastComparison: null,
  error: null,
  isProcessing: false,
  isChecking: false
};

const comparison = setupComparison();
let activeHumanizationController = null;
let activeDetectorController = null;
const articleStore = createCheckpointStore();
const articleProgress = document.querySelector('#articleProgress');
const cancelArticle = document.querySelector('#cancelArticle');
let lockedControls = [];

function lockArticleControls(locked) {
  if (locked) {
    lockedControls = [...document.querySelectorAll('input, select, textarea, #importDocumentButton, #clearButton, #restoreButton, #checkAIButton, #resumeArticle, #forgetArticle, #pasteTextButton, #sampleTextButton, #uploadDocumentButton, #rewriteSelectionButton, #undoSelectionButton')]
      .map(control => ({ control, disabled: control.disabled }));
    for (const { control } of lockedControls) control.disabled = true;
  } else {
    for (const { control, disabled } of lockedControls) control.disabled = disabled;
    lockedControls = [];
  }
  cancelArticle.hidden = !locked;
}

function showArticleProgress(progress) {
  articleProgress.hidden = false;
  const label = progress.waiting
    ? `Aguardando limite do serviço (${Math.ceil(progress.waitMs/1000)}s). ${progress.completed}/${progress.total} blocos salvos.`
    : `${progress.resumed ? 'Retomando · ' : ''}${progress.completed}/${progress.total} blocos concluídos · ${progress.completedWords.toLocaleString('pt-BR')} palavras processadas.`;
  document.querySelector('#articleProgressLabel').textContent = label + (progress.checkpointAvailable ? '' : ' Retomada indisponível: mantenha a aba aberta.');
  const bar = document.querySelector('#articleProgressBar');
  bar.max = progress.total;
  bar.value = progress.completed;
}

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
  syncRewriteProfile();
}

function setStateStatus(status, error = null) {
  state.processingStatus = status;
  state.error = error;
  setProcessingStatus(status, error?.message || '');
}

function updateInputState() {
  const helpers = document.querySelector('#inputHelpers');
  if (helpers) helpers.hidden = Boolean(state.originalText.trim());
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
  const requestOriginalText = state.originalText;
  try {
    state.isProcessing = true;
    activeHumanizationController = new AbortController();
    articleProgress.hidden = true;
    setLoading(true);
    lockArticleControls(true);
    setStateStatus('processing');

    const options = {
      ...buildHumanizationOptions(state.preferences, state.instructions),
      limits: APP_CONFIG.textLimits,
      signal: activeHumanizationController.signal,
      onProgress: showArticleProgress
    };
    const response = await humanizeText(requestOriginalText, options);
    state.lastRequest = response.request;
    if (response.partialOutput) {
      state.resultText = response.partialOutput;
      state.resultOriginalText = requestOriginalText;
      setResult(response.partialOutput);
      articleProgress.hidden = false;
      document.querySelector('#articleProgressLabel').textContent = 'Resultado parcial preservado. Clique em Humanizar texto para retomar com o mesmo artigo e configurações.';
    }

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
      state.resultOriginalText = response.request?.text || requestOriginalText;
      state.lastComparison = analyzeTexts(state.resultOriginalText, state.resultText);
      setStateStatus('completed');
      setResult(response.output);
      if (response.totalChunks) document.querySelector('#articleProgressLabel').textContent = `Artigo concluído · ${response.totalChunks} blocos processados.`;
    }
  } catch (error) {
    console.error(error);
    setStateStatus('error', { code: 'UNEXPECTED_ERROR', message: 'Ocorreu um erro inesperado.' });
    showToast('Não foi possível continuar', 'Ocorreu um erro inesperado. Tente novamente.', 'error');
  } finally {
    activeHumanizationController = null;
    state.isProcessing = false;
    setLoading(false);
    lockArticleControls(false);
  }
}

function cancelHumanization() {
  if (!state.isProcessing || !activeHumanizationController) return false;
  activeHumanizationController.abort('cancelled');
  return true;
}

async function requestDetectorCheck() {
  if (state.isChecking) return;
  const validation = validateDetectionText(state.originalText, APP_CONFIG.textLimits);
  if (!validation.valid) {
    showToast('Texto necessário', validation.message, 'error');
    elements.originalText.focus();
    return;
  }

  try {
    state.isChecking = true;
    state.detectorStatus = 'checking';
    state.detectorReport = null;
    state.detectorOriginalText = state.originalText;
    activeDetectorController = new AbortController();
    elements.checkAIButton.disabled = true;
    elements.checkAIButton.setAttribute('aria-busy', 'true');
    renderDetectorLoading();
    elements.detectorDialog.showModal();
    const report = await analyzeAuthorship(state.detectorOriginalText, { limits: APP_CONFIG.textLimits, signal: activeDetectorController.signal });
    state.detectorStatus = report.status;
    if (report.status === 'cancelled') return;
    state.detectorReport = report;
    renderDetectorResults(report, state.detectorOriginalText);
  } catch (error) {
    console.error(error);
    state.detectorStatus = 'error';
    renderDetectorResults({ status: 'error', error: { message: 'Não foi possível concluir a análise. Tente novamente.' } });
  } finally {
    state.isChecking = false;
    activeDetectorController = null;
    elements.checkAIButton.disabled = false;
    elements.checkAIButton.setAttribute('aria-busy', 'false');
  }
}

function bindEditor() {
  bindDocumentImport({
    panel: elements.inputPanel,
    editor: elements.originalText,
    input: elements.documentInput,
    button: elements.importDocumentButton,
    status: elements.documentImportStatus,
    onMessage: showToast,
    onImport: (text) => {
      if (state.isProcessing) return;
      if (state.originalText) state.originalBackup = state.originalText;
      state.originalText = text;
      elements.originalText.value = text;
      elements.restoreButton.disabled = !state.originalBackup;
      updateInputState();
    }
  });

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
  cancelArticle.addEventListener('click', cancelHumanization);
  document.querySelector('#resumeArticle').addEventListener('click', async () => {
    try {
      const saved = await articleStore.read();
      if (!saved?.text) return showToast('Sem artigo salvo', 'Nenhum processamento por blocos foi salvo neste navegador.', 'info');
      state.originalBackup = state.originalText;
      state.originalText = saved.text;
      elements.originalText.value = saved.text;
      state.preferences = { ...state.preferences, processingMode: saved.options.processingMode,
        mode: saved.options.writingMode, language: saved.options.language,
        instructions: saved.options.instructions, ...saved.options.adjustments };
      restorePreferences(); persist(); updateInputState();
      showToast('Artigo restaurado', 'Clique em Humanizar texto para continuar dos blocos salvos.', 'success');
    } catch { showToast('Armazenamento indisponível', 'Não foi possível restaurar o artigo salvo.', 'error'); }
  });
  document.querySelector('#forgetArticle').addEventListener('click', async () => {
    try { await articleStore.clear(); showToast('Cópia local removida', 'O checkpoint do artigo foi apagado deste navegador.', 'success'); }
    catch { showToast('Não foi possível apagar', 'O armazenamento local está indisponível.', 'error'); }
  });

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
    if (!comparison.open(state.resultOriginalText, state.resultText)) {
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
  elements.detectorDialog.addEventListener('close', () => activeDetectorController?.abort());
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

function syncRewriteProfile() {
  const select = document.querySelector('#rewriteProfile');
  if (!select) return;
  const { mode, processingMode } = state.preferences;
  select.value = mode === 'academico' && processingMode === 'advanced' ? 'academic'
    : mode === 'natural' && processingMode === 'advanced' ? 'fluent'
    : mode === 'natural' && processingMode === 'instant' ? 'natural' : 'custom';
}

function bindStudio() {
  const sample = 'As bibliotecas públicas oferecem espaços de estudo e acesso a livros que muitas famílias não conseguem comprar. Também disponibilizam computadores e atividades culturais. Para atender bem a comunidade, precisam de horários claros, equipes preparadas e materiais atualizados. Os recursos digitais ampliam o alcance desses serviços, mas não substituem o espaço físico. Ouvir os moradores ajuda a definir prioridades e melhorar o atendimento. Pequenas mudanças, como sinalização acessível e áreas silenciosas, podem tornar esses espaços mais acolhedores.';
  const replaceInput = text => {
    if (state.isProcessing) return;
    state.originalBackup = state.originalText;
    state.originalText = String(text);
    elements.originalText.value = state.originalText;
    elements.restoreButton.disabled = !state.originalBackup;
    updateInputState();
    elements.originalText.focus();
  };
  document.querySelector('#sampleTextButton')?.addEventListener('click', () => replaceInput(sample));
  document.querySelector('#pasteTextButton')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return showToast('Área de transferência vazia', 'Copie um texto antes de colar.', 'info');
      replaceInput(text);
    } catch {
      elements.originalText.focus();
      showToast('Cole no editor', 'Use Ctrl+V ou o comando Colar do seu dispositivo.', 'info');
    }
  });
  document.querySelector('#uploadDocumentButton')?.addEventListener('click', () => {
    if (!state.isProcessing) elements.importDocumentButton.click();
  });
  document.querySelector('#rewriteProfile')?.addEventListener('change', event => {
    const presets = { natural: ['natural', 'instant'], fluent: ['natural', 'advanced'], academic: ['academico', 'advanced'] };
    const preset = presets[event.target.value];
    if (!preset || state.isProcessing) return;
    [state.preferences.mode, state.preferences.processingMode] = preset;
    restorePreferences();
    persist();
  });
  syncRewriteProfile();

  const rewrite = document.querySelector('#rewriteSelectionButton');
  const undo = document.querySelector('#undoSelectionButton');
  if (!rewrite || !undo) return;
  let selected = null;
  let previous = null;
  let previousOutput = null;
  const updateSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (elements.resultText.contains(range.startContainer) && elements.resultText.contains(range.endContainer)) {
        const prefix = range.cloneRange();
        prefix.selectNodeContents(elements.resultText);
        prefix.setEnd(range.startContainer, range.startOffset);
        const raw = range.toString();
        const start = prefix.toString().length + raw.length - raw.trimStart().length;
        const end = prefix.toString().length + raw.trimEnd().length;
        selected = { start, end, snapshot: state.resultText };
      } else selected = null;
    } else selected = null;
    rewrite.disabled = state.isProcessing || !selected || selected.snapshot !== state.resultText
      || selected.end <= selected.start || selected.end - selected.start > 6000;
  };
  document.addEventListener('selectionchange', updateSelection);
  rewrite.addEventListener('pointerdown', event => event.preventDefault());
  rewrite.addEventListener('click', async () => {
    if (rewrite.disabled || !selected || state.isProcessing) return;
    const { start, end, snapshot } = selected;
    if (snapshot !== state.resultText) return;
    try {
      state.isProcessing = true;
      activeHumanizationController = new AbortController();
      setLoading(true);
      lockArticleControls(true);
      setStateStatus('processing');
      const response = await humanizeText(snapshot.slice(start, end), {
        ...buildHumanizationOptions(state.preferences, state.instructions),
        context: { before: snapshot.slice(Math.max(0, start - 800), start), after: snapshot.slice(end, end + 800) },
        signal: activeHumanizationController.signal, limits: APP_CONFIG.textLimits
      });
      if (response.status !== 'completed') {
        setStateStatus('completed');
        if (response.status !== 'cancelled') showToast('Trecho preservado', response.error?.message || 'Não foi possível reescrever o trecho.', 'error');
        return;
      }
      previous = snapshot;
      state.resultText = snapshot.slice(0, start) + response.output.trim() + snapshot.slice(end);
      previousOutput = state.resultText;
      state.lastComparison = analyzeTexts(state.resultOriginalText, state.resultText);
      setResult(state.resultText);
      setStateStatus('completed');
      showToast('Trecho reescrito', 'O restante do resultado foi preservado.', 'success');
    } catch {
      setStateStatus('completed');
      showToast('Trecho preservado', 'Não foi possível concluir a reescrita.', 'error');
    } finally {
      activeHumanizationController = null;
      state.isProcessing = false;
      setLoading(false);
      lockArticleControls(false);
      undo.disabled = !previous;
      selected = null;
      rewrite.disabled = true;
    }
  });
  undo.addEventListener('click', () => {
    if (!previous || state.isProcessing) return;
    if (state.resultText !== previousOutput) { previous = null; undo.disabled = true; return; }
    state.resultText = previous;
    previous = null;
    state.lastComparison = analyzeTexts(state.resultOriginalText, state.resultText);
    setResult(state.resultText);
    setStateStatus('completed');
    undo.disabled = true;
    selected = null;
    rewrite.disabled = true;
  });
  elements.humanizeButton.addEventListener('click', () => { previous = null; undo.disabled = true; });
}

function initialize() {
  restorePreferences();
  bindPreferenceControls();
  bindEditor();
  bindDialogs();
  bindHeader();
  bindStudio();
  updateInputState();
  setResult('');

  window.AvatarApp = Object.freeze({
    getState: () => structuredClone(state),
    getConfiguration: () => structuredClone(APP_CONFIG),
    cancelHumanization,
    setHumanizedText: (text) => {
      if (typeof text !== 'string' || !text.trim()) throw new TypeError('O resultado deve ser um texto não vazio.');
      state.resultText = text.normalize('NFC');
      state.resultOriginalText = state.originalText;
      state.lastComparison = analyzeTexts(state.resultOriginalText, state.resultText);
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
