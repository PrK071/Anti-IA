# AVATAR

**Sua voz, mais humana.** Um estúdio de texto para revisar e reescrever conteúdo com controle sobre tom, idioma e fidelidade ao original.

O AVATAR usa HTML, CSS e JavaScript Vanilla no navegador. A humanização é feita pelo DeepSeek por meio de uma Vercel Function; a chave da API permanece no servidor.

## Recursos

| Edição e análise | Humanização |
| --- | --- |
| Contagem de palavras e caracteres | Modos Instantâneo, Avançado e Preciso |
| Copiar, limpar e restaurar o original | Seis tons de escrita e sete variantes de idioma |
| Comparação determinística entre versões | Ajustes de formalidade, criatividade e extensão |
| Exportação do resultado em TXT | Instruções personalizadas e preservação de estrutura |
| Tema claro e escuro | Estados de processamento, cancelamento e erros claros |

Os verificadores de autoria por IA aparecem como **indisponíveis** até que seus serviços sejam integrados. Eles não exibem pontuações fictícias.

## Como funciona

```text
Navegador (HTML + CSS + JS)
        │
        └── POST /api/humanize
                  │
                  └── Vercel Function ── DeepSeek API
```

O navegador envia o texto e as preferências ao endpoint do próprio AVATAR. A função valida os dados, escolhe o modelo configurado no servidor e devolve somente o texto reescrito. O original continua disponível para comparação.

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

```powershell
node --test tests/*.test.mjs
```

Os testes cobrem validação, modos, resposta do endpoint, tratamento de erros, cópia, exportação e recursos já existentes. Uma requisição real ao DeepSeek depende de uma credencial válida e de créditos disponíveis.

## Licença

Distribuído sob a [licença MIT](LICENSE).
