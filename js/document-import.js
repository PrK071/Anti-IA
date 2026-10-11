import { APP_CONFIG } from '../config.js';
import { validateText } from './text-analysis.js';

export const DOCUMENT_FORMATS = Object.freeze(['pdf', 'docx', 'md', 'markdown', 'txt', 'csv', 'tsv']);
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 300;
let mammothPromise;

function loadMammoth() {
  if (globalThis.mammoth) return Promise.resolve(globalThis.mammoth);
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../vendor/mammoth/mammoth.browser.min.js', import.meta.url).href;
      script.onload = () => globalThis.mammoth
        ? resolve(globalThis.mammoth)
        : reject(new Error('Não foi possível carregar o leitor de DOCX.'));
      script.onerror = () => {
        script.remove();
        reject(new Error('Não foi possível carregar o leitor de DOCX. Tente novamente.'));
      };
      document.head.append(script);
    }).catch((error) => {
      mammothPromise = null;
      throw error;
    });
  }
  return mammothPromise;
}

function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)) throw new Error('binary');
    return text;
  } catch {
    throw new Error('O arquivo não contém texto válido. Salve-o como UTF-8 ou UTF-16 e tente novamente.');
  }
}

async function readPDF(buffer, limits, onProgress) {
  const pdfjs = await import('../vendor/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`Importe um PDF com até ${MAX_PDF_PAGES} páginas.`);
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      onProgress(`Lendo página ${number} de ${pdf.numPages}…`);
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        if (text && !/\s$/u.test(text) && item.str && !/^\s/u.test(item.str)) text += ' ';
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      pages.push(text.trim());
      page.cleanup();
      const validation = validateText(pages.join('\n\n'), limits);
      if (!validation.valid && validation.code !== 'EMPTY_TEXT') throw new Error(validation.message);
    }
    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error('Este PDF não contém texto selecionável. Use OCR no documento digitalizado antes de importar.');
    return text;
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('O PDF está protegido por senha. Importe uma cópia desbloqueada.');
    if (error.name === 'InvalidPDFException') throw new Error('O PDF está inválido ou corrompido. Tente outra cópia.');
    throw error;
  } finally {
    await task.destroy();
  }
}

export async function readDocument(file, { limits = APP_CONFIG.textLimits, onProgress = () => {} } = {}) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (!DOCUMENT_FORMATS.includes(extension)) {
    throw new Error('Formato não suportado. Use PDF, DOCX, MD, TXT, CSV ou TSV. Para arquivos .doc, salve uma cópia em .docx.');
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 20 MB. Importe um documento menor.');
  if (file.size === 0) throw new Error('O arquivo está vazio.');
  onProgress('Extraindo texto…');
  const buffer = await file.arrayBuffer();
  let text;
  if (extension === 'pdf') {
    text = await readPDF(buffer, limits, onProgress);
  } else if (extension === 'docx') {
    const mammoth = await loadMammoth();
    try {
      // Only extract plain text. Never render HTML or load document links/images.
      text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
    } catch {
      throw new Error('Não foi possível ler o DOCX. Confira se o arquivo é válido e não está protegido por senha.');
    }
  } else {
    text = decodeText(buffer);
  }
  text = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').replace(/\u0000/gu, '').normalize('NFC').trim();
  const validation = validateText(text, limits);
  if (validation.code === 'EMPTY_TEXT') throw new Error('Nenhum texto foi encontrado no documento.');
  if (!validation.valid) throw new Error(validation.message);
  return text;
}

export function bindDocumentImport({ panel, editor, input, button, status, onImport, onMessage }) {
  let busy = false;
  let dragDepth = 0;
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  };
  const importFiles = async (files) => {
    if (busy || !files.length) return;
    if (files.length !== 1) {
      setStatus('Importe um arquivo por vez.', true);
      onMessage('Importação não concluída', 'Importe um arquivo por vez.', 'error');
      return;
    }
    const file = files[0];
    const previousText = editor.value;
    busy = true;
    button.disabled = true;
    input.disabled = true;
    button.setAttribute('aria-busy', 'true');
    panel.setAttribute('aria-busy', 'true');
    setStatus(`Importando ${file.name}…`);
    try {
      const text = await readDocument(file, { onProgress: setStatus });
      if (editor.value !== previousText) {
        throw new Error('O texto foi editado durante a leitura. Importe novamente para substituir a versão atual.');
      }
      onImport(text);
      setStatus(`${file.name} · texto importado`);
      editor.focus();
      onMessage('Arquivo importado', previousText ? 'Texto disponível no editor. Use Restaurar para recuperar o texto anterior.' : 'Texto disponível no editor para verificar IA ou humanizar.', 'success');
    } catch (error) {
      setStatus(error.message || 'Não foi possível ler o arquivo.', true);
      onMessage('Importação não concluída', error.message || 'Não foi possível ler o arquivo.', 'error');
    } finally {
      busy = false;
      button.disabled = false;
      input.disabled = false;
      input.value = '';
      button.setAttribute('aria-busy', 'false');
      panel.setAttribute('aria-busy', 'false');
    }
  };
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => importFiles([...input.files]));
  editor.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return; // Keep ordinary text paste native.
    event.preventDefault();
    importFiles(files);
  });
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  const resetDrag = () => {
    dragDepth = 0;
    panel.classList.remove('is-dragging');
  };
  panel.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    panel.classList.add('is-dragging');
  });
  panel.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  });
  panel.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) resetDrag();
  });
  panel.addEventListener('drop', (event) => {
    resetDrag();
    if (!hasFiles(event)) return;
    event.preventDefault();
    importFiles([...event.dataTransfer.files]);
  });
  window.addEventListener('dragend', resetDrag);
}
