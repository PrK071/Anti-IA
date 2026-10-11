const panel = document.querySelector('#chatgptConnection');
let session = null;
let loginTimer;
let working = false;

panel.innerHTML = `
  <div class="chatgpt-heading"><div><span class="eyebrow">AVATAR LOCAL</span><h2 id="chatgptConnectionTitle">Use seu plano ChatGPT</h2></div><span class="chatgpt-local-tag">No seu computador</span></div>
  <p>Usa a cota da sua assinatura existente. Sem chave de API, compra de créditos ou alternativa por API paga.</p>
  <div class="chatgpt-actions"><button id="chatgptLogin" class="chatgpt-signin" type="button">Continue with ChatGPT</button><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Gerenciar uso no ChatGPT ↗</a><button id="chatgptDisconnect" class="text-button" type="button" hidden>Desconectar</button></div>
  <p id="chatgptStatus" role="status">Consultando conexão…</p>
  <div id="chatgptCostGuard" class="chatgpt-cost-guard" hidden><strong>Configure para usar apenas sua cota</strong><p>Em Gerenciar uso, encontre AVATAR Local e desative o uso de créditos após atingir o limite do plano. Essa configuração pertence ao ChatGPT; o AVATAR não consegue alterá-la automaticamente.</p><label><input id="chatgptNoCredits" type="checkbox"> Confirmei que o uso de créditos para AVATAR Local está desativado no ChatGPT.</label><button id="chatgptEnable" type="button" disabled>Usar somente a cota do plano</button></div>
  <div id="chatgptModelControl" hidden><label for="chatgptModel">Modelo disponível na sua conta</label><select id="chatgptModel"></select><p class="chatgpt-note">A verificação é uma avaliação do modelo. Ela não reproduz o GPTZero nem garante um percentual de autoria.</p></div>
  <p id="chatgptError" role="alert" hidden></p>`;

const control = (id) => panel.querySelector(`#${id}`);
function showError(message) {
  control('chatgptError').textContent = message;
  control('chatgptError').hidden = !message;
}
async function post(path, body = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Não foi possível concluir esta operação.');
  return data;
}
function render() {
  if (!session) return;
  control('chatgptLogin').hidden = session.connected;
  control('chatgptDisconnect').hidden = !session.connected;
  control('chatgptCostGuard').hidden = !session.connected || session.creditsDisabled && !session.quotaReached;
  control('chatgptModelControl').hidden = !session.connected || !session.creditsDisabled;
  control('chatgptStatus').textContent = !session.connected ? 'Entre com sua conta ChatGPT Plus para começar.'
    : session.quotaReached ? 'Limite da cota atingido. Aguarde e consulte Gerenciar uso. Nenhuma API paga será acionada.'
    : !session.creditsDisabled ? `Conectado${session.email ? ` como ${session.email}` : ''}. Falta confirmar que o uso de créditos está desativado.`
    : 'Você está usando a cota do seu plano ChatGPT. Configure os ajustes abaixo e revise seu texto.';
  const select = control('chatgptModel');
  const existing = [...select.options].map((option) => option.value).join('|');
  if (existing !== session.models.map((model) => model.slug).join('|')) {
    select.replaceChildren(...session.models.map((model) => { const option = document.createElement('option'); option.value = model.slug; option.textContent = model.name; return option; }));
  }
  if (session.selectedModel) select.value = session.selectedModel;
  if (!session.loginPending) { clearInterval(loginTimer); loginTimer = undefined; }
}
async function refresh() {
  try {
    const response = await fetch('/api/chatgpt/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('O serviço local não respondeu. Abra novamente pelo atalho.');
    session = await response.json();
    render();
  } catch (error) { showError(error.message); }
}
control('chatgptLogin').addEventListener('click', async () => {
  if (working) return;
  const popup = window.open('about:blank', 'avatar-chatgpt-login');
  working = true;
  showError('');
  try {
    const { authorizationUrl } = await post('/api/chatgpt/login');
    if (!popup) throw new Error('Permita abrir a janela de login neste site local e tente novamente.');
    popup.location.replace(authorizationUrl);
    await refresh();
    if (loginTimer) clearInterval(loginTimer);
    loginTimer = setInterval(refresh, 3000);
  } catch (error) { popup?.close(); showError(error.message); }
  finally { working = false; }
});
control('chatgptDisconnect').addEventListener('click', async () => {
  try { await post('/api/chatgpt/disconnect'); control('chatgptNoCredits').checked = false; control('chatgptEnable').disabled = true; showError(''); await refresh(); }
  catch (error) { showError(error.message); }
});
control('chatgptNoCredits').addEventListener('change', () => { control('chatgptEnable').disabled = !control('chatgptNoCredits').checked; });
control('chatgptEnable').addEventListener('click', async () => {
  if (working || !control('chatgptNoCredits').checked) return;
  working = true;
  control('chatgptEnable').disabled = true;
  showError('');
  try { session = await post('/api/chatgpt/enable', { creditsDisabled: true }); render(); }
  catch (error) { showError(error.message); }
  finally { working = false; control('chatgptEnable').disabled = !control('chatgptNoCredits').checked; }
});
control('chatgptModel').addEventListener('change', async () => {
  try { await post('/api/chatgpt/model', { model: control('chatgptModel').value }); showError(''); await refresh(); }
  catch (error) { showError(error.message); }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('#humanizeButton, #checkAIButton')) return;
  if (!session?.connected || !session.creditsDisabled || session.quotaReached) {
    event.preventDefault(); event.stopImmediatePropagation();
    showError(!session?.connected ? 'Entre com ChatGPT no painel acima para começar.' : session.quotaReached ? 'Aguarde a cota ficar disponível e consulte Gerenciar uso.' : 'Confirme que o uso de créditos está desativado antes de continuar.');
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}, true);
window.addEventListener('focus', refresh);
await refresh();
