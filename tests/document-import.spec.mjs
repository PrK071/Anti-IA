import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
test.beforeEach(async ({ page }, testInfo) => {
  await page.goto(testInfo.project.name === 'dist' ? '/dist/' : '/');
  await expect(page.locator('#importDocumentButton')).toBeEnabled();
});

test('importa DOCX real, atualiza estado e contadores, restaura e verifica IA', async ({ page }) => {
  await page.locator('#originalText').fill('Texto anterior.');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#importDocumentButton').click();
  await (await chooser).setFiles(fixture('documento.docx'));
  await expect(page.locator('#originalText')).toHaveValue('Olá, ação em português.\n\nSegundo parágrafo do documento.');
  expect(await page.evaluate(() => window.AvatarApp.getState().originalText)).toBe('Olá, ação em português.\n\nSegundo parágrafo do documento.');
  await expect(page.locator('#wordCount')).toHaveText('8');
  await page.locator('#originalText').fill('Olá, ação em português. Segundo parágrafo do documento. '.repeat(6));
  await page.locator('#checkAIButton').click();
  await expect(page.locator('#detectorDialog')).toBeVisible();
  await expect(page.locator('#detectorResults')).toContainText('Configure DEEPSEEK_API_KEY');
  await page.locator('#closeDetectorButton').click();
  await page.locator('#restoreButton').click();
  await expect(page.locator('#originalText')).toHaveValue('Texto anterior.');
});

test('extrai todas as páginas de PDF real com acentos', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#documentInput').setInputFiles(fixture('documento.pdf'));
  await expect(page.locator('#originalText')).toHaveValue('Olá, ação em português.\n\nSegunda página do PDF.');
  await expect(page.locator('#documentImportStatus')).toContainText('documento.pdf · texto importado');
  await expect(page.locator('#importDocumentButton')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('arrasta Markdown e cola arquivo TXT sem interpretar HTML', async ({ page }) => {
  await page.locator('#originalText').evaluate((editor) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['# Título\n\nAção **clara**.'], 'texto.md', { type: 'text/markdown' }));
    editor.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.locator('#originalText')).toHaveValue('# Título\n\nAção **clara**.');
  await page.locator('#originalText').evaluate((editor) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<script>window.importExecuted = true</script>'], 'texto.txt', { type: 'text/plain' }));
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await expect(page.locator('#originalText')).toHaveValue('<script>window.importExecuted = true</script>');
  expect(await page.evaluate(() => window.importExecuted)).toBeUndefined();
  expect(await page.locator('#originalText').evaluate((editor) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'Texto colado.');
    return editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  })).toBe(true);
});

test('erros preservam o texto e permitem importar novamente o mesmo arquivo', async ({ page }) => {
  await page.locator('#originalText').fill('Preserve este texto.');
  for (const [name, buffer, error] of [
    ['invalido.docx', Buffer.from('invalid'), /DOCX/u],
    ['invalido.pdf', Buffer.from('invalid'), /PDF está inválido/u],
    ['grande.md', Buffer.from('a'.repeat(50001)), /50.000/u]
  ]) {
    await page.locator('#documentInput').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
    await expect(page.locator('#documentImportStatus')).toHaveText(error);
    await expect(page.locator('#originalText')).toHaveValue('Preserve este texto.');
    await expect(page.locator('#importDocumentButton')).toBeEnabled();
  }
  await page.locator('#documentInput').setInputFiles(fixture('sem-texto.pdf'));
  await expect(page.locator('#documentImportStatus')).toContainText('Use OCR');
  await page.locator('#documentInput').setInputFiles(fixture('documento.docx'));
  await expect(page.locator('#documentImportStatus')).toContainText('texto importado');
  await page.locator('#clearButton').click();
  await page.locator('#documentInput').setInputFiles(fixture('documento.docx'));
  await expect(page.locator('#originalText')).toHaveValue(/Segundo parágrafo/u);
});

test('não sobrescreve alterações feitas enquanto o leitor carrega', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/vendor/mammoth/mammoth.browser.min.js', async (route) => {
    await gate;
    await route.continue();
  });
  await page.locator('#documentInput').setInputFiles(fixture('documento.docx'));
  await expect(page.locator('#importDocumentButton')).toBeDisabled();
  await page.locator('#originalText').fill('Nova edição durante a leitura.');
  release();
  await expect(page.locator('#documentImportStatus')).toContainText('editado durante a leitura');
  await expect(page.locator('#originalText')).toHaveValue('Nova edição durante a leitura.');
});

test('editor e botão de importação cabem no viewport', async ({ page }) => {
  await page.locator('.input-panel').scrollIntoViewIfNeeded();
  const panel = await page.locator('.input-panel').boundingBox();
  const button = await page.locator('#importDocumentButton').boundingBox();
  const width = page.viewportSize().width;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(width);
  expect(button.x + button.width).toBeLessThanOrEqual(panel.x + panel.width);
  await page.locator('.input-panel').screenshot({ path: test.info().outputPath('editor.png') });
});
