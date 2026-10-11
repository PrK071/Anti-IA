import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = 'https://auth.openai.com';
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const terminalRefreshErrors = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

export class PlanError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

// Windows DPAPI encrypts credentials for the current Windows user. Secrets travel
// through stdin/stdout between our processes, never command-line arguments.
function dpapi(value, decrypt) {
  if (process.platform !== 'win32') throw new PlanError('LOCAL_STORAGE_UNAVAILABLE', 'Esta versão local requer Windows para proteger o login.');
  return new Promise((resolve, reject) => {
    const script = `Add-Type -AssemblyName System.Security; $payload=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($payload,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new PlanError('LOCAL_STORAGE_UNAVAILABLE', 'Não foi possível proteger o login no Windows.')));
    child.on('exit', (code) => code === 0 ? resolve(Buffer.from(output.trim(), 'base64')) : reject(new PlanError('LOCAL_STORAGE_UNAVAILABLE', 'Não foi possível ler ou proteger o login no Windows.')));
    child.stdin.end(Buffer.from(value).toString('base64'));
  });
}

export function protectedStore(filename) {
  return {
    async load() {
      try { return JSON.parse((await dpapi(await readFile(filename), true)).toString('utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async save(value) {
      await mkdir(dirname(filename), { recursive: true });
      const encrypted = await dpapi(Buffer.from(JSON.stringify(value)), false);
      await writeFile(`${filename}.tmp`, encrypted, { mode: 0o600 });
      await rename(`${filename}.tmp`, filename);
    }
  };
}

const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
export async function verifyIdentity(token, clientId, nonce, keys = jwks) {
  const { payload } = await jwtVerify(token, keys, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
  if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new PlanError('INVALID_IDENTITY', 'Não foi possível validar a identidade do login.');
  return payload;
}

function tokenRecord(tokens, prior, identity) {
  if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.token_type?.toLowerCase() !== 'bearer'
    || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new PlanError('INVALID_TOKEN_RESPONSE', 'O login não retornou uma autorização válida.');
  return { ...prior, subject: identity.sub, email: typeof identity.email === 'string' ? identity.email : prior.email || '',
    access_token: tokens.access_token, refresh_token: tokens.refresh_token || prior.refresh_token,
    id_token: tokens.id_token || prior.id_token,
    scopes: typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/u) : prior.scopes || [],
    expires_at: Date.now() + tokens.expires_in * 1000 };
}

export function createChatGPTPlan({ store, fetcher = (...args) => fetch(...args), verify = verifyIdentity }) {
  let record;
  let pending;
  let refreshPromise;
  let models = [];
  let creditsDisabled = false;
  let quotaReached = false;
  const persist = () => store.save(record);
  const sharing = () => Boolean(record?.access_token && record.scopes?.includes('chatgpt.tokens.use.direct'));
  async function tokenRequest(parameters) {
    const response = await fetcher(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ ...parameters, resource: RESOURCE }), signal: AbortSignal.timeout(20_000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : data.error?.code;
      if (terminalRefreshErrors.has(code)) throw new PlanError('LOGIN_EXPIRED', 'Seu login expirou. Entre novamente.', 401);
      throw new PlanError('LOGIN_UNAVAILABLE', 'Não foi possível concluir o login. Tente novamente.', response.status === 403 ? 403 : 502);
    }
    return data;
  }
  async function accessToken() {
    if (!sharing()) throw new PlanError('CHATGPT_NOT_CONNECTED', 'Entre com ChatGPT e permita o uso da cota do seu plano.', 401);
    if (record.expires_at > Date.now() + 60_000) return record.access_token;
    if (!record.refresh_token) throw new PlanError('LOGIN_EXPIRED', 'Seu login expirou. Entre novamente.', 401);
    if (!refreshPromise) refreshPromise = (async () => {
      try {
        const tokens = await tokenRequest({ grant_type: 'refresh_token', client_id: record.client_id, refresh_token: record.refresh_token });
        const identity = tokens.id_token ? await verify(tokens.id_token, record.client_id) : { sub: record.subject, email: record.email };
        if (identity.sub !== record.subject) throw new PlanError('INVALID_IDENTITY', 'O login retornou outra identidade.', 401);
        record = tokenRecord(tokens, record, identity);
        await persist();
        if (!sharing()) throw new PlanError('CHATGPT_NOT_CONNECTED', 'A permissão de uso do plano não está ativa.', 401);
        return record.access_token;
      } catch (error) {
        if (error.code === 'LOGIN_EXPIRED') {
          record = { host_id: record.host_id, client_id: record.client_id, subject: record.subject, email: record.email };
          creditsDisabled = false;
          models = [];
          await persist();
        }
        throw error;
      } finally { refreshPromise = undefined; }
    })();
    return refreshPromise;
  }
  return {
    async init() {
      record = await store.load() || { host_id: `urn:uuid:${randomUUID()}` };
      if (!record.host_id) throw new PlanError('INVALID_LOCAL_SESSION', 'O login local precisa ser configurado novamente.');
      await persist();
    },
    status() {
      return { app: 'avatar-chatgpt-local', connected: sharing(), email: record?.email || '', creditsDisabled, quotaReached, models,
        usageUrl: 'https://chatgpt.com/settings/usage', loginPending: Boolean(pending && pending.expires > Date.now()) };
    },
    startLogin(redirectUri, browserSession) {
      const verifier = randomBytes(48).toString('base64url');
      pending = { state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), verifier,
        redirectUri, browserSession, clientId: record.client_id, subject: record.subject, expires: Date.now() + 10 * 60_000 };
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      url.search = new URLSearchParams({ client_id: pending.clientId || 'dynamic_agent_client',
        ...(!pending.clientId ? { agent_name_hint: 'AVATAR Local' } : {}), ext_agent_host_id: record.host_id,
        response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
        state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
      return url.href;
    },
    async callback(url, browserSession) {
      const attempt = pending;
      if (!attempt || attempt.expires < Date.now() || browserSession !== attempt.browserSession || url.searchParams.get('state') !== attempt.state) {
        throw new PlanError('INVALID_LOGIN_STATE', 'Este pedido de login expirou ou não é válido. Volte ao AVATAR e entre novamente.', 400);
      }
      pending = undefined;
      if (url.searchParams.has('error')) throw new PlanError('LOGIN_DECLINED', 'O login foi cancelado. Nenhum texto foi enviado.', 400);
      const suppliedClient = url.searchParams.get('client_id');
      const clientId = attempt.clientId || suppliedClient;
      const code = url.searchParams.get('code');
      if (!clientId || clientId === 'dynamic_agent_client' || (attempt.clientId && suppliedClient && suppliedClient !== attempt.clientId) || !code) {
        throw new PlanError('INVALID_LOGIN_CALLBACK', 'A autorização retornada não é válida. Entre novamente.', 400);
      }
      // Retain the issued registration if its one-time code has already expired.
      record.client_id = clientId;
      await persist();
      const tokens = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri });
      if (typeof tokens.id_token !== 'string') throw new PlanError('INVALID_IDENTITY', 'O login não retornou uma identidade verificável.', 401);
      const identity = await verify(tokens.id_token, clientId, attempt.nonce);
      if (attempt.subject && identity.sub !== attempt.subject) throw new PlanError('INVALID_IDENTITY', 'A conta retornada é diferente. Desconecte antes de trocar de conta.', 401);
      record = tokenRecord(tokens, record, identity);
      creditsDisabled = false;
      quotaReached = false;
      models = [];
      await persist();
      return this.status();
    },
    async disconnect() {
      pending = undefined;
      record = { host_id: record.host_id };
      creditsDisabled = false;
      quotaReached = false;
      models = [];
      await persist();
    },
    acknowledgeCreditsDisabled(value) {
      if (!sharing() || value !== true) throw new PlanError('COST_GUARD_REQUIRED', 'Desative o uso de créditos para AVATAR Local no ChatGPT e confirme antes de continuar.', 403);
      creditsDisabled = true;
      quotaReached = false;
    },
    async listModels() {
      const token = await accessToken();
      const response = await fetcher(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new PlanError('MODELS_UNAVAILABLE', 'Não foi possível consultar os modelos disponíveis na sua conta.', response.status);
      const data = await response.json();
      models = (Array.isArray(data.models) ? data.models : []).filter((item) => item.visibility === 'list' && typeof item.slug === 'string' && typeof item.display_name === 'string')
        .map((item) => ({ slug: item.slug, name: item.display_name }));
      if (!models.length) throw new PlanError('NO_MODELS_AVAILABLE', 'Sua conta não disponibilizou modelos para esta integração.', 403);
      return models;
    },
    async complete(messages, model, signal) {
      if (!creditsDisabled) throw new PlanError('COST_GUARD_REQUIRED', 'Desative o uso de créditos no ChatGPT e confirme essa configuração no AVATAR.', 403);
      if (quotaReached) throw new PlanError('PLAN_LIMIT_REACHED', 'A cota do plano atingiu um limite. Aguarde e consulte Gerenciar uso.', 429);
      const token = await accessToken();
      if (!models.some((item) => item.slug === model)) throw new PlanError('INVALID_MODEL', 'Selecione um modelo disponível na sua conta.', 400);
      const response = await fetcher(`${RESOURCE}/responses`, { method: 'POST', signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ model, instructions: messages.filter((item) => item.role === 'system').map((item) => item.content).join('\n'),
          input: messages.filter((item) => item.role !== 'system'), store: false, stream: true }) });
      const providerFailure = (code, status) => {
        if (code === 'subscription_sharing_usage_limit_exceeded' || status === 429) {
          quotaReached = true;
          return new PlanError('PLAN_LIMIT_REACHED', 'A cota do plano atingiu um limite. Aguarde; não será usada uma API paga como alternativa.', 429);
        }
        if (code === 'subscription_sharing_user_not_eligible') return new PlanError('PLAN_NOT_ELIGIBLE', 'Sua conta não está elegível para compartilhar a cota nesta integração.', 403);
        return new PlanError('CHATGPT_UNAVAILABLE', 'O ChatGPT não concluiu o pedido. Verifique seu login ou tente mais tarde.', status || 502);
      };
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw providerFailure(error.error?.code, response.status);
      }
      let buffer = '';
      let output = '';
      let completed = false;
      const decoder = new TextDecoder();
      const readEvent = (block) => {
        const raw = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!raw || raw === '[DONE]') return;
        let event;
        try { event = JSON.parse(raw); } catch { throw new PlanError('INVALID_STREAM', 'O ChatGPT retornou uma resposta incompleta.'); }
        if (event.type === 'response.output_text.delta') output += event.delta || '';
        if (output.length > 200_000) throw new PlanError('OUTPUT_TOO_LARGE', 'A resposta excedeu o limite de tamanho.');
        if (event.type === 'response.failed' || event.type === 'error') throw providerFailure(event.response?.error?.code || event.error?.code || event.code);
        if (event.type === 'response.incomplete') throw new PlanError('INCOMPLETE_RESPONSE', 'A reescrita não foi concluída. Tente uma seção menor.');
        if (event.type === 'response.completed') {
          if (event.response?.status !== 'completed') throw new PlanError('INCOMPLETE_RESPONSE', 'O ChatGPT não concluiu a resposta.');
          completed = true;
        }
      };
      try {
        for await (const chunk of response.body) {
          signal?.throwIfAborted();
          buffer += decoder.decode(chunk, { stream: true });
          buffer = buffer.replace(/\r\n/gu, '\n');
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) { readEvent(buffer.slice(0, index)); buffer = buffer.slice(index + 2); }
          if (buffer.length > 500_000) throw new PlanError('INVALID_STREAM', 'O ChatGPT retornou um evento inválido.');
        }
        buffer += decoder.decode();
        if (buffer.trim()) readEvent(buffer);
      } catch (error) { throw error; }
      if (!completed || !output.trim()) throw new PlanError('INCOMPLETE_RESPONSE', 'A resposta foi interrompida. Nenhum resultado parcial foi aplicado.');
      return output.normalize('NFC').trim();
    }
  };
}
