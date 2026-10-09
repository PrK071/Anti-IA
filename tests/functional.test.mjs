import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { countWords, countText, validateText, compareTexts as analyzeTexts } from '../js/text-analysis.js';
import { humanizeText, buildHumanizationOptions } from '../js/humanizer.js';
import { checkAI, checkMultipleDetectors } from '../js/detectors.js';
import { compareTexts } from '../js/compare.js';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from '../js/settings.js';

test('conta palavras, caracteres e Unicode corretamente', () => {
  const text = 'Ação clara em português — sem perder acentuação.';
  assert.equal(countWords(text), 8);
  assert.deepEqual(countText('Olá mundo'), { words: 2, characters: 9 });
});

test('valida vazio e aceita limite máximo configurável', () => {
  assert.equal(validateText('   ').code, 'EMPTY_TEXT');
  const limited = validateText('um dois três', { maxWords: 2, maxCharacters: 100, warningThreshold: 0.9 });
  assert.equal(limited.code, 'WORD_LIMIT_EXCEEDED');
  const warning = validateText('123456789', { maxWords: null, maxCharacters: 10, warningThreshold: 0.9 });
  assert.equal(warning.valid, true);
  assert.equal(warning.warnings.length, 1);
});

test('modos do Humanizer 2.0 geram perfis distintos', () => {
  const base = { ...DEFAULT_PREFERENCES, language: 'fr-FR' };
  const instant = buildHumanizationOptions({ ...base, processingMode: 'instant' }, 'Préserver les dates.');
  const advanced = buildHumanizationOptions({ ...base, processingMode: 'advanced' }, 'Préserver les dates.');
  const precise = buildHumanizationOptions({ ...base, processingMode: 'precise' }, 'Préserver les dates.');
  assert.equal(instant.processingMode, 'instant');
  assert.equal(advanced.processingProfile.rewriteDepth, 'deep');
  assert.equal(precise.processingProfile.semanticFidelity, 'maximum');
  assert.equal(instant.language, 'fr-FR');
  assert.equal(instant.instructions, 'Préserver les dates.');
});

test('humanização retorna serviço não configurado sem saída falsa', async () => {
  const options = buildHumanizationOptions(DEFAULT_PREFERENCES, 'Preserve números.');
  const result = await humanizeText('O valor é R$ 25,00.', options);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.output, null);
  assert.equal(result.error.code, 'AI_NOT_CONFIGURED');
});

test('humanização trata texto vazio como erro', async () => {
  const result = await humanizeText('', buildHumanizationOptions(DEFAULT_PREFERENCES));
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'EMPTY_TEXT');
});

test('detectores preservam resultados separados e indisponíveis', async () => {
  const single = await checkAI('Texto suficiente para análise.', 'gptzero');
  assert.equal(single.status, 'not_configured');
  assert.equal(single.result, null);
  const report = await checkMultipleDetectors('Texto suficiente para análise.', ['gptzero', 'copyleaks', 'zerogpt', 'originality']);
  assert.equal(report.status, 'not_configured');
  assert.equal(report.results.length, 4);
  assert.ok(report.results.every((item) => item.result === null && item.analyzedAt === null));
});

test('comparação detecta números, datas, nomes e volume sem alegar semântica', () => {
  const original = 'Em 10/09/2026, Maria Silva informou que o projeto AVATAR registrou 25 referências [1].';
  const rewritten = 'O projeto AVATAR registrou 24 referências.';
  const analysis = analyzeTexts(original, rewritten);
  assert.equal(analysis.checks.numbers.preserved, false);
  assert.equal(analysis.checks.dates.preserved, false);
  assert.equal(analysis.checks.properNames.preserved, false);
  assert.match(analysis.disclaimer, /não comprovam preservação semântica/i);
  const comparison = compareTexts(original, rewritten);
  assert.ok(comparison.diff.originalParts.some((part) => part.type === 'removed'));
});

test('preferências persistem modo, idioma e instruções', () => {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value)
  };
  const preferences = { ...DEFAULT_PREFERENCES, processingMode: 'precise', language: 'de-DE', instructions: 'Zahlen beibehalten.' };
  assert.equal(savePreferences(preferences), true);
  assert.equal(loadPreferences().processingMode, 'precise');
  assert.equal(loadPreferences().language, 'de-DE');
  assert.equal(loadPreferences().instructions, 'Zahlen beibehalten.');
});

test('cópia e exportação usam o conteúdo real recebido', async () => {
  let copied = '';
  let downloaded = false;
  let filename = '';
  const genericElement = () => ({
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, append() {}, appendChild() {}, replaceChildren() {},
    style: {}, dataset: {}
  });
  globalThis.window = { isSecureContext: true, setTimeout };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (value) => { copied = value; } } }
  });
  globalThis.document = {
    querySelector: () => genericElement(),
    createElement: (tag) => tag === 'a'
      ? { set href(value) {}, set download(value) { filename = value; }, click() { downloaded = true; }, remove() {} }
      : genericElement(),
    body: { append() {}, appendChild() {} },
    execCommand: () => true
  };
  const ui = await import(`../js/ui.js?test=${Date.now()}`);
  await ui.copyToClipboard('conteúdo real');
  ui.downloadText('conteúdo real', 'resultado.txt');
  assert.equal(copied, 'conteúdo real');
  assert.equal(downloaded, true);
  assert.equal(filename, 'resultado.txt');
});

test('HTML contém modos, idiomas, dicas e ações preservadas', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const value of ['instant', 'advanced', 'precise']) assert.match(html, new RegExp(`value="${value}"`));
  for (const value of ['pt-BR', 'en-US', 'es', 'fr-FR', 'de-DE', 'it-IT']) assert.match(html, new RegExp(`value="${value}"`));
  for (const id of ['tipsButton', 'checkAIButton', 'copyOriginalButton', 'restoreButton', 'compareButton']) assert.match(html, new RegExp(`id="${id}"`));
});
