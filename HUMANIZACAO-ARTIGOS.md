# Humanização de artigos de até 50 mil palavras

Os modos Instantâneo, Avançado e Preciso e os controles de tom, idioma, formalidade, criatividade, simplificação, tamanho e preservação são próprios do Anti IA. O fluxo usa como referência os controles públicos do Uncheck, sem reproduzir seu modelo proprietário, seus resultados ou promessas de aprovação em detectores.

## Processamento

- Limite por artigo: 50.000 palavras e 2.000.000 de caracteres. A importação PDF/DOCX/TXT/Markdown continua disponível; o teto de arquivo é 20 MB e PDF tem até 300 páginas.
- Divisão em blocos de até 800 palavras e 6.000 caracteres, preferindo limites de parágrafo. Cada palavra entra uma vez. Espaços entre blocos são conservados na montagem; a redação dentro de cada bloco pode mudar conforme as opções.
- Até 1.200 caracteres anteriores e seguintes servem de contexto. O modelo recebe instrução para reescrever somente o bloco atual. Isso auxilia continuidade, sem garantir coesão ou preservação semântica integral de um artigo inteiro.
- Requisições sequenciais ao endpoint existente evitam uma única função serverless de longa duração. O tempo limite é por bloco, não por artigo. Pausas por rate limit respeitam Retry-After, com até três novas tentativas do bloco; blocos concluídos não são reenviados ao retomar.
- IndexedDB mantém apenas o último artigo, opções e blocos concluídos neste navegador. “Restaurar artigo salvo” recupera o texto e opções; “Humanizar texto” retoma. Alterar texto/opções inicia outro trabalho. “Apagar cópia local” remove o checkpoint. Se o armazenamento falhar, o processamento pode continuar, mas sem garantia de retomada.
- A aba deve permanecer aberta durante a execução. Não há worker durável em segundo plano. Pausar ou fechar a aba pode interromper a chamada atual; a eventual cobrança dessa chamada depende do provedor. Os blocos já salvos permanecem.

## Serviço de IA

Configure DEEPSEEK_API_KEY no servidor, conforme .env.example. Chaves nunca vão ao frontend. O motor é a integração oficial existente do Anti IA; não foi obtida nem usada uma API privada ou credencial do Uncheck. Artigos longos geram várias chamadas pagas segundo o plano do provedor.

A verificação de autoria continua uma operação separada, com limite de 50.000 caracteres; não é uma verificação automática de todo o artigo de 50 mil palavras. O modo local com ChatGPT mantém suas regras próprias de conexão e cobrança.

## Verificação

Os testes de orquestração e navegador usam respostas controladas para verificar cobertura de 50 mil palavras, ordenação, Unicode, contexto, progresso, erros parciais e retomada. Não são medições de qualidade editorial, fidelidade ao Uncheck ou desempenho contra detectores. Inferência real exige uma credencial autorizada configurada no ambiente.
