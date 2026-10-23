// JavaScript / long-document.spec.mjs / Playwright / root and built article flow
import { test, expect } from '@playwright/test';
const route = info => info.project.name==='dist' ? '/dist/' : '/';

test('reescreve 50 mil palavras por blocos e mantém todo o resultado', async ({page},info)=>{
  let calls=0; const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/humanize',async req=>{
    const body=req.request().postDataJSON(); calls++;
    expect(body.text.length).toBeLessThanOrEqual(6000);
    expect(body.context.before.length).toBeLessThanOrEqual(1200);
    await req.fulfill({json:{status:'completed',output:body.text,model:'test-provider',usage:{totalTokens:1}}});
  });
  await page.goto(route(info));
  const text=Array.from({length:50000},(_,i)=>`w${i}`).join(' ');
  await page.locator('#originalText').fill(text);
  await expect(page.locator('#wordCount')).toHaveText('50.000');
  await page.locator('#humanizeButton').click();
  await expect(page.locator('#resultText')).toHaveText(text,{timeout:60000});
  await expect(page.locator('#articleProgressLabel')).toContainText('Artigo concluído');
  await expect(page.locator('#cancelArticle')).toBeHidden();
  expect(calls).toBeGreaterThan(50); expect(errors).toEqual([]);
  await page.reload();
  await page.locator('#resumeArticle').click();
  await expect(page.locator('#originalText')).toHaveValue(text);
  const completedCalls=calls;
  await page.locator('#humanizeButton').click();
  await expect(page.locator('#resultText')).toHaveText(text);
  expect(calls).toBe(completedCalls);
});

test('falha parcial restaura checkpoints após reload sem reapagar o original',async({page},info)=>{
  let calls=0,fail=true;
  await page.route('**/api/humanize',async req=>{
    calls++; const body=req.request().postDataJSON();
    if(calls===2&&fail)return req.fulfill({status:502,json:{error:{code:'PROVIDER_TIMEOUT',message:'Falha de teste'}}});
    return req.fulfill({json:{status:'completed',output:body.text,model:'test-provider'}});
  });
  await page.goto(route(info));const text='Texto de teste. '.repeat(1000).trim();
  await page.locator('#originalText').fill(text);await page.locator('#humanizeButton').click();
  await expect(page.locator('#articleProgressLabel')).toContainText('Resultado parcial');
  await expect(page.locator('#originalText')).toHaveValue(text);
  fail=false;await page.reload();await page.locator('#resumeArticle').click();
  await expect(page.locator('#originalText')).toHaveValue(text);
  await page.locator('#humanizeButton').click();
  await expect(page.locator('#resultText')).toHaveText(text,{timeout:20000});
});
