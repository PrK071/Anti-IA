# Anti-IA

**Sua voz, mais humana.** Um estúdio de texto para revisar e reescrever conteúdo com controle sobre tom, idioma e fidelidade ao original.

O Anti IA usa HTML, CSS e JavaScript Vanilla no navegador. A humanização é feita pelo DeepSeek por meio de uma Vercel Function; a chave da API permanece no servidor.

## Versão local com sua assinatura ChatGPT

O modo local usa o login oficial **Sign in with ChatGPT** e a cota do plano da conta elegível. Ele não lê `.env`, não usa chaves de APIs pagas e não muda de provedor quando a cota acaba. A integração requer Windows e Node.js 22 ou superior. Depois de instalar as dependências, execute `scripts/install-shortcut.ps1` para criar **Anti IA Local** na área de trabalho; o atalho inicia o serviço em `http://127.0.0.1:3187` e abre o navegador. Também é possível iniciar com `npm run local`.

1. Clique em **Continue with ChatGPT** e autorize o uso do plano na página oficial.
2. Abra **Gerenciar uso no ChatGPT**, encontre **Anti IA Local** e desative o uso de créditos após atingir o limite do plano. O ChatGPT controla essa opção; o Anti IA não tem uma API para verificá-la ou alterá-la. A interface exige sua confirmação antes de habilitar o processamento.
3. Selecione um dos modelos retornados para sua conta e use o editor normalmente. A verificação continua sendo uma avaliação subjetiva do modelo, diferente do detector GPTZero.

O login é armazenado em `.local/chatgpt.bin`, criptografado pelo Windows DPAPI para seu usuário. Tokens não são enviados ao JavaScript do navegador. O serviço aceita apenas conexões de loopback com a origem local, valida estado/PKCE/nonce e identidade assinada, renova o login quando necessário e descarta saídas incompletas. Desconectar remove as credenciais locais; para revogar também a permissão na OpenAI, use as configurações do ChatGPT. Após reiniciar o serviço ou entrar novamente, confirme novamente a configuração de créditos.

Referências oficiais: [login e autorização](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [modelos e inferência](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [limites e uso de créditos](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

## Recursos

| Edição e análise | Humanização |
| --- | --- |
| Contagem de palavras e caracteres | Modos Instantâneo, Avançado e Preciso |
| Copiar, limpar e restaurar o original | Seis tons de escrita e sete variantes de idioma |
| Comparação determinística entre versões | Ajustes de formalidade, criatividade e extensão |
| Exportação do resultado em TXT | Instruções personalizadas e preservação de estrutura |
| Tema claro e escuro | Estados de processamento, cancelamento e erros claros |

O botão **Verificar IA** consulta um endpoint real e exibe classificação humano/misto/IA, as três categorias, explicação e trechos sinalizados. A análise usa DeepSeek ou a API oficial do GPTZero, conforme a configuração do servidor.

## Ativar a análise de IA

Para usar DeepSeek, basta configurar `DEEPSEEK_API_KEY`, a mesma chave da humanização. A avaliação é feita pelo modelo: os percentuais são pesos subjetivos, sem calibração de detector. A interface identifica isso explicitamente.

Se o DeepSeek retornar um relatório vazio, truncado ou fora do formato exigido, o servidor solicita uma nova análise uma única vez. As duas tentativas compartilham o limite total de 45 segundos e o cancelamento; a recuperação pode consumir uma segunda chamada à API. Erros de autenticação, créditos, limite do serviço e rede não são repetidos automaticamente. Os logs registram apenas a categoria da falha e o ID da solicitação, sem texto, resposta do modelo ou chave.

Para usar o detector do GPTZero, configure `GPTZERO_API_KEY`. As probabilidades, classificação, confiança e destaques são os retornados pela API oficial. Isso não garante resultados idênticos a todas as versões, planos ou recursos do aplicativo GPTZero.

| Variável | Uso na verificação |
| --- | --- |
| `AI_DETECTOR_PROVIDER` | `auto` por padrão: usa GPTZero se houver chave; caso contrário, DeepSeek. Também aceita `deepseek` ou `gptzero` para selecionar explicitamente. |
| `DEEPSEEK_API_KEY` | Credencial do DeepSeek, usada exclusivamente no servidor. |
| `DEEPSEEK_DETECTOR_MODEL` | Opcional: `deepseek-flash` ou `deepseek-v4-pro`. Na ausência, usa `DEEPSEEK_MODEL` ou `deepseek-flash`. |
| `GPTZERO_API_KEY` | Credencial da API oficial do GPTZero; o login do aplicativo não substitui essa chave. |

No site publicado, configure as variáveis no projeto da Vercel e faça um novo deploy. Sem chave, a interface informa a configuração necessária e não cria scores. A análise requer 250 caracteres, aceita até 50.000 e não comprova autoria. As porcentagens não representam a fração de palavras geradas por IA.

A chave nunca vai para o navegador. O texto é enviado a `/api/detect` e ao provedor configurado somente ao solicitar a análise. Fechar a janela cancela a requisição. Validação, timeout, bloqueio de duplicatas e limite por instância protegem o endpoint; configure também rate limiting na Vercel para `/api/detect` em instalações públicas.

## Importar documentos

No painel **Texto original**, use **Importar arquivo**, arraste um documento para o campo ou cole um arquivo com `Ctrl+V` quando o navegador disponibilizar arquivos na área de transferência. A colagem normal de texto continua funcionando.

- Formatos: PDF, DOCX, MD/Markdown, TXT, CSV e TSV.
- Um arquivo por vez, até 20 MB e 50.000 caracteres de texto; PDFs aceitam até 300 páginas.
- A extração ocorre no navegador. O arquivo original não é enviado ao servidor. O texto extraído entra no fluxo existente de humanização e verificação.
- A importação substitui o campo. **Restaurar** recupera o texto anterior. Erros e edições feitas durante a leitura preservam o conteúdo atual.
- PDFs precisam conter texto selecionável. PDFs digitalizados requerem OCR antes da importação; documentos protegidos precisam ser desbloqueados. Arquivos antigos `.doc` precisam ser convertidos para `.docx`.
- Arquivos de texto aceitam UTF-8 e UTF-16 com BOM. A importação mantém o conteúdo textual, sem reproduzir a formatação visual ou executar HTML.

Os leitores [PDF.js](https://mozilla.github.io/pdf.js/) e [Mammoth](https://github.com/mwilliamson/mammoth.js) são carregados somente quando necessários, a partir de `vendor/`, sem CDN. Suas licenças estão nas respectivas pastas. A versão em `dist/` também inclui a importação.

## Como funciona

```text
Navegador (HTML + CSS + JS)
        │
        └── POST /api/humanize
                  │
                  └── Vercel Function ── DeepSeek API
```

O navegador envia o texto e as preferências ao endpoint do próprio Anti IA. A função valida os dados, escolhe o modelo configurado no servidor e devolve somente o texto reescrito. O original continua disponível para comparação.

## Publicar na Vercel

1. Importe este repositório na Vercel.
2. Mantenha a raiz do repositório como **Root Directory** e selecione **Framework Preset: Other**. Não é necessário comando de build.
3. Em **Settings → Environment Variables**, cadastre `DEEPSEEK_API_KEY` para os ambientes desejados.
4. Faça um novo deploy depois de configurar a variável.

| Variável | Uso |
| --- | --- |
| `DEEPSEEK_API_KEY` | Obrigatória. Credencial privada usada apenas pela função serverless. |
| `DEEPSEEK_MODEL` | Opcional. `deepseek-flash` por padrão; também aceita `deepseek-v4-pro`. |

O arquivo [.env.example](.env.example) documenta os nomes das variáveis sem incluir credenciais. Arquivos `.env` locais estão no `.gitignore`.

## Segurança e controle de custos

O endpoint aceita somente `POST`, valida os modos e ajustes, limita o tamanho da entrada e da saída, impõe timeout e bloqueia pedidos idênticos simultâneos na mesma instância. As mensagens de erro não incluem dados internos do provedor.

Para proteger todas as instâncias, configure uma regra de **rate limiting na Vercel Firewall** para `/api/humanize`. Um ponto de partida é cinco solicitações `POST` por IP a cada 60 segundos; ajuste o valor conforme o uso. Em uma instalação privada, habilite também autenticação ou Deployment Protection. A checagem de origem e o limite em memória são camadas complementares, não substitutos desses controles.

## Desenvolvimento e testes

Abra o projeto por um servidor local compatível com módulos JavaScript. Para testar também `/api/humanize`, use um ambiente local da Vercel com as variáveis configuradas. Os testes automatizados não precisam de uma chave real:

O projeto também inclui um servidor local para o site e os dois endpoints. Copie `.env.example` para `.env`, preencha a chave diretamente nesse arquivo ignorado pelo Git, execute `npm run dev` e abra `http://127.0.0.1:3000`. Reinicie o servidor após alterar `.env`. Abrir `index.html` diretamente ou usar um servidor exclusivamente estático não executa as APIs.

```powershell
node --test tests/*.test.mjs
```

Os testes cobrem validação, modos, resposta do endpoint, tratamento de erros, cópia, exportação e recursos já existentes. Uma requisição real ao DeepSeek depende de uma credencial válida e de créditos disponíveis.

Para instalar as ferramentas de desenvolvimento, atualizar as cópias locais das bibliotecas e executar os testes de importação no navegador, use Node.js 22.13 ou superior:

```powershell
npm ci
npm run vendor
npx playwright install chromium
npm test
npm run test:browser
```

Os testes de navegador cobrem PDFs e DOCX reais, seleção, arrastar, colar, restauração, limites, erros e edições durante a importação, além do relatório de IA, destaques, cancelamento e tratamento seguro de respostas. A suíte exercita a raiz e `dist/`, em desktop e celular. Os provedores são simulados nos testes; validar disponibilidade e qualidade reais exige uma chave configurada. O site publicado continua dispensando um comando de build.

## Licença

Distribuído sob a [licença MIT](LICENSE).
# Artigos de até 50.000 palavras

A humanização agora processa artigos de até 50 mil palavras em blocos com progresso, pausa e retomada local. Consulte [HUMANIZACAO-ARTIGOS.md](HUMANIZACAO-ARTIGOS.md) para limites, preservação de dados, custos do provedor e critérios de validação. O recurso usa o modelo configurado no Anti IA; não reproduz o modelo proprietário do Uncheck.
