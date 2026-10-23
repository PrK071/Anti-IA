// JavaScript / long-document.js / browser + Node 24 / resumable article rewriting
export const CHUNK_WORDS = 800;
export const CHUNK_CHARACTERS = 6000;

export function splitDocument(input) {
  const text = String(input).normalize('NFC').trim();
  const tokens = [...text.matchAll(/\S+\s*/gu)];
  const chunks = [];
  let start = 0;
  while (start < tokens.length) {
    let end = start;
    let paragraphEnd = -1;
    const offset = tokens[start].index;
    while (end < tokens.length && end - start < CHUNK_WORDS) {
      const token = tokens[end];
      if (token.index + token[0].trimEnd().length - offset > CHUNK_CHARACTERS) break;
      end++;
      if (/\n\s*\n/u.test(token[0]) && end - start >= 200) paragraphEnd = end;
    }
    if (end === start) throw new Error('Uma palavra excede 6.000 caracteres. Revise o documento.');
    if (end < tokens.length && paragraphEnd > start) end = paragraphEnd;
    const last = tokens[end - 1];
    const boundary = last.index + last[0].length;
    const raw = text.slice(offset, boundary);
    const content = raw.trimEnd();
    chunks.push({ text: content, separator: raw.slice(content.length), words: end-start });
    start = end;
  }
  return chunks;
}

export function joinDocument(chunks, outputs) {
  return outputs.map((output, index) => output + chunks[index].separator).join('').trimEnd();
}

export function abortableWait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelado', 'AbortError'));
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelado', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

export function createCheckpointStore() {
  let dbPromise;
  async function db() {
    if (!globalThis.indexedDB) return null;
    dbPromise ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('avatar-articles', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('checkpoints');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  async function operation(write, value) {
    const database = await db();
    if (!database) return null;
    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', write ? 'readwrite' : 'readonly');
      const store = tx.objectStore('checkpoints');
      const request = write ? (value === undefined ? store.delete('latest') : store.put(value, 'latest')) : store.get('latest');
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Falha no armazenamento local.'));
    });
  }
  return { read: () => operation(false), write: value => operation(true, value), clear: () => operation(true, undefined) };
}

export async function processDocument(text, options, sendChunk, dependencies = {}) {
  const chunks = splitDocument(text);
  const store = dependencies.store || createCheckpointStore();
  const wait = dependencies.wait || abortableWait;
  const publicOptions = { processingMode: options.processingMode, writingMode: options.writingMode,
    language: options.language, instructions: options.instructions, adjustments: options.adjustments };
  const identityBytes = new TextEncoder().encode(JSON.stringify({ version: 1, text, options: publicOptions }));
  const identity = [...new Uint8Array(await crypto.subtle.digest('SHA-256', identityBytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  let outputs = [], cached, checkpointAvailable = true;
  try { cached = await store.read(); } catch { checkpointAvailable = false; }
  if (cached?.identity === identity && Array.isArray(cached.outputs)
      && cached.outputs.length <= chunks.length && cached.outputs.every(x => typeof x === 'string' && x.trim())) {
    outputs = cached.outputs.slice();
  }
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  if (cached?.identity === identity && cached.usage) usage = { ...usage, ...cached.usage };
  let model = cached?.identity === identity ? cached.model : null;
  const notify = extra => options.onProgress?.({ completed: outputs.length, total: chunks.length,
    completedWords: chunks.slice(0, outputs.length).reduce((sum, item) => sum+item.words, 0),
    checkpointAvailable, ...extra });
  const partial = () => joinDocument(chunks, outputs);
  notify({ resumed: outputs.length > 0 });
  for (let i=outputs.length; i<chunks.length; i++) {
    if (options.signal?.aborted) return { status: 'cancelled', output: null, partialOutput: partial() };
    let response;
    for (let attempt=0; attempt<4; attempt++) {
      notify({ current: i+1, waiting: false });
      response = await sendChunk(chunks[i].text, { ...options,
        context: { before: i ? outputs[i-1].slice(-1200) : '', after: chunks[i+1]?.text.slice(0,1200) || '' } });
      if (!['RATE_LIMITED','PROVIDER_RATE_LIMITED'].includes(response.error?.code) || attempt===3) break;
      const waitMs = Math.min(300000, Math.max(1000, response.retryAfterMs || 61000));
      notify({ current: i+1, waiting: true, waitMs });
      try { await wait(waitMs, options.signal); } catch {
        return { status: 'cancelled', output: null, partialOutput: partial() };
      }
    }
    if (response.status !== 'completed') return { ...response, output: null, partialOutput: partial(), completedChunks: outputs.length, totalChunks: chunks.length };
    outputs.push(response.output);
    model = response.model || model;
    for (const key of Object.keys(usage)) usage[key] += Number(response.usage?.[key]) || 0;
    try { await store.write({ identity, text, options: publicOptions, outputs: outputs.slice(), usage, model, savedAt: new Date().toISOString() }); }
    catch { checkpointAvailable = false; }
    notify({ current: i+1, waiting: false });
  }
  return { status: 'completed', output: partial(), model, usage, error: null, totalChunks: chunks.length };
}
