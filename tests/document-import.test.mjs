import test from 'node:test';
import assert from 'node:assert/strict';
import { readDocument, MAX_FILE_BYTES } from '../js/document-import.js';

test('importa formatos de texto, mantém acentos e normaliza linhas', async () => {
  for (const name of ['texto.TXT', 'texto.md', 'texto.markdown', 'texto.csv', 'texto.tsv']) {
    const file = new File(['\uFEFFOlá, ação!\r\n\r\nSegundo parágrafo.\rFim.'], name);
    assert.equal(await readDocument(file), 'Olá, ação!\n\nSegundo parágrafo.\nFim.');
  }
});

test('aceita texto UTF-16 com BOM', async () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ação em português.', 'utf16le')]);
  assert.equal(await readDocument(new File([bytes], 'texto.txt')), 'Ação em português.');
});

test('rejeita formatos não suportados antes de ler o arquivo', async () => {
  await assert.rejects(readDocument({ name: 'arquivo.doc', size: 100, arrayBuffer() { throw new Error('Não deve ler'); } }), /salve uma cópia em .docx/u);
});

test('rejeita arquivos vazios, binários disfarçados e textos sem conteúdo', async () => {
  await assert.rejects(readDocument(new File([], 'vazio.txt')), /arquivo está vazio/u);
  await assert.rejects(readDocument(new File([' \n\t'], 'vazio.md')), /Nenhum texto/u);
  await assert.rejects(readDocument(new File([new Uint8Array([0, 1, 2, 255])], 'binario.txt')), /texto válido/u);
});

test('rejeita limites de arquivo e texto sem truncar o documento', async () => {
  await assert.rejects(readDocument({ name: 'grande.pdf', size: MAX_FILE_BYTES + 1, arrayBuffer() { throw new Error('Não deve ler'); } }), /20 MB/u);
  await assert.rejects(readDocument(new File(['a'.repeat(50001)], 'grande.md')), /50.000 caracteres/u);
  assert.equal((await readDocument(new File(['a'.repeat(50000)], 'limite.txt'))).length, 50000);
});
