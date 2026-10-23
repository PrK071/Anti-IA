// JavaScript / studio.spec.mjs / Playwright / desktop source and mobile dist
import { test, expect } from '@playwright/test';
const pathFor = info => info.project.name === 'dist' ? '/dist/' : '/';

test('exemplo e estilo acadêmico usam as opções reais sem ultrapassar a tela', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let payload;
  await page.route('**/api/humanize', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json: { status: 'completed', output: 'Uma biblioteca oferece acesso à leitura e à informação.', model: 'test-provider' } });
  });
  await page.goto(pathFor(info));
  await page.screenshot({ path: info.outputPath('studio.png'), fullPage: true });
  await page.locator('#sampleTextButton').click();
  expect(await page.locator('#originalText').inputValue()).toContain('bibliotecas públicas');
  await expect(page.locator('#inputHelpers')).toBeHidden();
  await page.locator('#rewriteProfile').selectOption('academic');
  await page.locator('#humanizeButton').click();
  await expect(page.locator('#resultText')).toContainText('Uma biblioteca');
  expect(payload.options.writingMode).toBe('academico');
  expect(payload.options.processingMode).toBe('advanced');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('reescrita selecionada preserva o entorno e desfaz; falha mantém o resultado', async ({ page }, info) => {
  const initial = 'Introdução. A leitura amplia o vocabulário. Conclusão.';
  let calls = 0;
  await page.route('**/api/humanize', async route => {
    calls++;
    const data = route.request().postDataJSON();
    if (calls === 1) return route.fulfill({ json: { status: 'completed', output: initial } });
    expect(data.text).toBe('A leitura amplia o vocabulário.');
    expect(data.context.before).toContain('Introdução.');
    expect(data.context.after).toContain('Conclusão.');
    if (calls === 3) return route.fulfill({ status: 502, json: { error: { code: 'PROVIDER_ERROR', message: 'Falha controlada' } } });
    return route.fulfill({ json: { status: 'completed', output: 'Ler expande o vocabulário.' } });
  });
  await page.goto(pathFor(info));
  await page.locator('#originalText').fill(initial);
  await page.locator('#humanizeButton').click();
  await expect(page.locator('#resultText')).toHaveText(initial);
  const select = async () => {
    await page.locator('#resultText').evaluate(node => {
      const start = node.textContent.indexOf('A leitura');
      const end = node.textContent.indexOf(' Conclusão.');
      const range = document.createRange(); range.setStart(node.firstChild, start); range.setEnd(node.firstChild, end);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await expect(page.locator('#rewriteSelectionButton')).toBeEnabled();
  };
  await select(); await page.locator('#rewriteSelectionButton').click();
  await expect(page.locator('#resultText')).toHaveText('Introdução. Ler expande o vocabulário. Conclusão.');
  await page.locator('#undoSelectionButton').click();
  await expect(page.locator('#resultText')).toHaveText(initial);
  await select(); await page.locator('#rewriteSelectionButton').click();
  await expect(page.locator('#humanizeButton')).toBeEnabled();
  await expect(page.locator('#resultText')).toHaveText(initial);
  expect(calls).toBe(3);
});
