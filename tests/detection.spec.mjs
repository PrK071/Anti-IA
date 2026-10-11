import { test, expect } from '@playwright/test';

const original = 'A experiência de escrever envolve decisões sobre vocabulário, contexto e intenção. Cada revisão permite avaliar a clareza das ideias e a relação entre os argumentos. A autoria de um texto não pode ser comprovada apenas pelo estilo ou por sua correção gramatical.';
const start = original.indexOf('Cada revisão');
const end = original.indexOf('A autoria');
const report = { status: 'completed', provider: 'deepseek', model: 'deepseek-flash', scoreKind: 'model_assessment',
  classification: 'mixed', confidence: 'low', scores: { human: 0.2, mixed: 0.7, ai: 0.1 },
  summary: 'Há indícios mistos. Uma avaliação de estilo não comprova autoria.', wordCount: 42,
  analyzedAt: '2026-10-10T23:00:00Z', highlights: [{ start, end, reason: 'Trecho para revisão.' }] };

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto(testInfo.project.name === 'dist' ? '/dist/' : '/');
});

test('verifica texto importado e exibe categorias, explicação e trechos do original', async ({ page }) => {
  let captured;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/detect', async (route) => {
    captured = route.request().postDataJSON();
    await gate;
    await route.fulfill({ json: report });
  });
  await page.locator('#documentInput').setInputFiles({ name: 'analise.md', mimeType: 'text/markdown', buffer: Buffer.from(original) });
  await expect(page.locator('#originalText')).toHaveValue(original);
  await page.locator('#checkAIButton').click();
  await expect(page.locator('#detectorResults')).toContainText('Analisando seu texto');
  release();
  await expect(page.locator('.detector-verdict')).toHaveText('Indícios de autoria mista');
  await expect(page.locator('.detector-scores')).toContainText('Humano20%Misto70%IA10%');
  await expect(page.locator('.detector-summary')).toContainText('DEEPSEEK · AVALIAÇÃO DO MODELO');
  await expect(page.locator('.detector-text')).toHaveText(original);
  await expect(page.locator('.detector-text mark')).toHaveText(original.slice(start, end).trim());
  expect(captured).toEqual({ text: original });
  const dialog = await page.locator('#detectorDialog').boundingBox();
  expect(dialog.x + dialog.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator('#detectorDialog').screenshot({ path: test.info().outputPath('analise-ia.png') });
  await page.locator('#closeDetectorButton').click();
  await expect(page.locator('#checkAIButton')).toBeEnabled();
});

test('apresenta resultados oficiais com origem correta e trata HTML como texto', async ({ page }) => {
  const value = `<img src=x onerror="window.analysisXss=true"> ${original}`;
  await page.route('**/api/detect', (route) => route.fulfill({ json: { ...report, provider: 'gptzero', model: 'GPTZero', scoreKind: 'detector_probability', summary: '<script>window.analysisXss=true</script>', highlights: [] } }));
  await page.locator('#originalText').fill(value);
  await page.locator('#checkAIButton').click();
  await expect(page.locator('.detector-summary')).toContainText('GPTZERO · DETECTOR OFICIAL');
  await expect(page.locator('.detector-summary')).toContainText('Probabilidades das categorias');
  await expect(page.locator('.detector-text')).toHaveText(value);
  await expect(page.locator('.detector-text img')).toHaveCount(0);
  expect(await page.evaluate(() => window.analysisXss)).toBeUndefined();
});

test('texto curto não chama API; ausência de chave informa configuração real', async ({ page }) => {
  let count = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/detect')) count += 1; });
  await page.locator('#originalText').fill('Texto curto.');
  await page.locator('#checkAIButton').click();
  await expect(page.locator('.toast-message')).toContainText('250 caracteres');
  expect(count).toBe(0);
  await page.locator('#originalText').fill(original);
  await page.locator('#checkAIButton').click();
  await expect(page.locator('#detectorResults')).toContainText('Configure DEEPSEEK_API_KEY');
  await expect(page.locator('.detector-score')).toHaveCount(0);
  await expect(page.locator('#checkAIButton')).toBeEnabled();
});

test('fechar a análise cancela a requisição e permite tentar novamente', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/detect', async (route) => { await gate; await route.fulfill({ json: report }).catch(() => {}); });
  await page.locator('#originalText').fill(original);
  await page.locator('#checkAIButton').click();
  await expect(page.locator('#detectorResults')).toContainText('Analisando');
  await page.locator('#closeDetectorButton').click();
  await expect(page.locator('#detectorDialog')).not.toBeVisible();
  await expect(page.locator('#checkAIButton')).toBeEnabled();
  expect(await page.evaluate(() => window.AvatarApp.getState().detectorStatus)).toBe('cancelled');
  release();
});

test('resposta inválida ou falha de rede não produz scores e libera o botão', async ({ page }) => {
  await page.route('**/api/detect', (route) => route.fulfill({ json: { ...report, scores: { ai: 200 } } }));
  await page.locator('#originalText').fill(original);
  await page.locator('#checkAIButton').click();
  await expect(page.locator('#detectorResults')).toContainText('análise recebida é inválida');
  await expect(page.locator('.detector-score')).toHaveCount(0);
  await page.locator('#closeDetectorButton').click();
  await page.unroute('**/api/detect');
  await page.route('**/api/detect', (route) => route.abort());
  await page.locator('#checkAIButton').click();
  await expect(page.locator('#detectorResults')).toContainText('Verifique sua conexão');
  await page.locator('#closeDetectorButton').click();
  await expect(page.locator('#checkAIButton')).toBeEnabled();
});
