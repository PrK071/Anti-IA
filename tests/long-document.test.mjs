// JavaScript / long-document.test.mjs / Node test runner / article orchestration
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDocument, joinDocument, processDocument, abortableWait } from '../js/long-document.js';
import { validateText } from '../js/text-analysis.js';
import { buildHumanizationOptions, humanizeText } from '../js/humanizer.js';
import { DEFAULT_PREFERENCES } from '../js/settings.js';
import { validatePayload, buildMessages } from '../api/humanize.mjs';

const options = () => buildHumanizationOptions(DEFAULT_PREFERENCES);
function memoryStore() {
  let saved;
  return { read: async () => saved, write: async value => { saved=structuredClone(value); } };
}
const echo = async text => ({ status:'completed', output:text, model:'test-provider', usage:{totalTokens:1} });

test('50 mil palavras entram, 50.001 são rejeitadas, sem perda ou duplicação nos blocos', () => {
  const text=Array.from({length:50000},(_,i)=>`palavra${i}`).join(' ');
  assert.equal(validateText(text).valid,true);
  assert.equal(validateText(text+' extra').code,'WORD_LIMIT_EXCEEDED');
  const chunks=splitDocument(text);
  assert.ok(chunks.length>50);
  assert.ok(chunks.every(c=>c.words<=800 && c.text.length<=6000));
  assert.equal(chunks.reduce((n,c)=>n+c.words,0),50000);
  assert.equal(joinDocument(chunks,chunks.map(c=>c.text)),text);
});

test('parágrafos, Unicode, títulos e referências sobrevivem à partição e montagem', () => {
  const text=('Introdução — ação e saúde. [Silva, 2024]\n\n'+'informação '.repeat(450)+'\r\n\r\n').repeat(6).trim();
  const chunks=splitDocument(text);
  assert.equal(joinDocument(chunks,chunks.map(c=>c.text)),text);
  assert.ok(chunks.slice(0,-1).some(c=>c.separator.includes('\n')));
});

test('artigo completo de 50 mil palavras passa por todos os envios e agrega uso', async () => {
  const text=Array.from({length:50000},(_,i)=>`w${i}`).join(' ');
  let calls=0;
  const r=await processDocument(text,options(),async(t,o)=>{
    calls++;
    if(calls>1) assert.ok(o.context.before);
    assert.ok(o.context.before.length<=1200 && o.context.after.length<=1200);
    return echo(t);
  },{store:memoryStore()});
  assert.equal(r.status,'completed');
  assert.equal(r.output,text);
  assert.equal(r.usage.totalTokens,calls);
  assert.equal(r.totalChunks,calls);
});

test('falha preserva saída parcial e retomada não reenvia blocos concluídos', async () => {
  const text=('Ação '.repeat(1900)).trim();
  const store=memoryStore(); let calls=0;
  const first=await processDocument(text,options(),async t=>{
    calls++; return calls===2 ? {status:'error',error:{code:'PROVIDER_TIMEOUT'}} : echo(t);
  },{store});
  assert.equal(first.status,'error'); assert.ok(first.partialOutput);
  let resumed=0;
  const second=await processDocument(text,options(),async t=>{resumed++;return echo(t);},{store});
  assert.equal(second.output,text);
  assert.equal(resumed,splitDocument(text).length-1);
});

test('alterar configurações invalida checkpoint, e documento concluído não é cobrado de novo', async () => {
  const text='conteúdo '.repeat(1000).trim();const store=memoryStore();
  await processDocument(text,options(),echo,{store});
  let calls=0;
  await processDocument(text,options(),async t=>{calls++;return echo(t);},{store});
  assert.equal(calls,0);
  await processDocument(text,{...options(),instructions:'Mude o ritmo.'},async t=>{calls++;return echo(t);},{store});
  assert.equal(calls,splitDocument(text).length);
});

test('429 respeita Retry-After e não duplica o bloco', async () => {
  let calls=0;const waits=[];
  const text='informação '.repeat(900).trim();
  const result=await processDocument(text,options(),async t=>{
    calls++;return calls===1 ? {status:'error',error:{code:'RATE_LIMITED'},retryAfterMs:2000} : echo(t);
  },{store:memoryStore(),wait:async ms=>waits.push(ms)});
  assert.equal(result.output,text);assert.deepEqual(waits,[2000]);
  assert.equal(calls,splitDocument(text).length+1);
});

test('pausa durante espera libera controle e mantém os blocos salvos', async () => {
  const controller=new AbortController();let calls=0;
  const text='palavra '.repeat(1800).trim();
  const r=await processDocument(text,{...options(),signal:controller.signal},async t=>{
    calls++;if(calls===1)return echo(t);
    return {status:'error',error:{code:'RATE_LIMITED'}};
  },{store:memoryStore(),wait:async()=>{controller.abort();throw new DOMException('Cancelado','AbortError');}});
  assert.equal(r.status,'cancelled');assert.ok(r.partialOutput);
  const c=new AbortController();c.abort();
  await assert.rejects(abortableWait(60000,c.signal),{name:'AbortError'});
});

test('armazenamento indisponível não destrói o processamento', async () => {
  const text='artigo '.repeat(900).trim();const seen=[];
  const r=await processDocument(text,{...options(),onProgress:p=>seen.push(p)},echo,
    {store:{read:async()=>{throw Error('blocked');},write:async()=>{throw Error('full');}}});
  assert.equal(r.output,text);assert.ok(seen.some(p=>!p.checkpointAvailable));
});

test('backend valida contexto e o mantém separado do trecho a reescrever', () => {
  const payload={text:'Texto principal.',options:options(),context:{before:'Anterior.',after:'Seguinte.'}};
  const result=validatePayload(payload);assert.ok(result.value);
  assert.match(buildMessages(result.value)[1].content,/não repita os contextos/);
  assert.equal(validatePayload({...payload,context:{before:'x'.repeat(1201),after:''}}).error[0],'INVALID_CONTEXT');
});

test('wrapper rejeita 50.001 palavras antes de fazer requisições', async () => {
  const result=await humanizeText('palavra '.repeat(50001),options());
  assert.equal(result.error.code,'WORD_LIMIT_EXCEEDED');
});
