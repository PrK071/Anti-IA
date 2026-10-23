# Investigação do Uncheck: o que foi observado

Data: 22/10/2026. Inspeção dos arquivos públicos servidos por https://uncheck.ai/ e de dois cenários no navegador, com REA. Não foi acessado código do servidor, conta de terceiros ou área autenticada.

## Artefatos

Foram baixados 119 scripts públicos, totalizando 11.984.864 bytes, sem falhas. O manifesto local registra URLs, tamanhos e SHA-256. A cópia de trabalho está em `C:\Users\luiz\uncheck-research`; os aproximadamente 20 MB de scripts e capturas não são incluídos neste repositório.

## Achados verificáveis

1. **Geração por serviço remoto.** O código do editor chama `api.byPass.generate.useMutation` e consulta `api.byPass.retrieval.useMutation` usando um `task_id`. Isso é evidência do contrato do frontend; a geração não chegou a ocorrer na sessão de teste sem cadastro.
2. **Parâmetros de interface.** O payload construído pelo frontend inclui `text`, `source`, `modelType`, `rewriteType`, `language` e `citationProtection`, além de campos condicionais para finalidade, arquivo ou verificação. Esses parâmetros não revelam a implementação da inferência.
3. **Alias de modelo.** O estado padrão usa `EBypassGPTModel.LATEST`, com uma versão local de preferência `20240131.01`. Há tratamento de um valor histórico `balanced`. Não há evidência suficiente para associar esses aliases a um checkpoint, arquitetura, fornecedor ou número de parâmetros. O termo GPT num identificador não comprova uso da API OpenAI.
4. **Limite adicional.** Um módulo público define `rewriteMaxWordLimit = 21000`. Isso não determina sozinho o limite do servidor nem a franquia de cada plano. O AVATAR implementa seu próprio processamento de 50 mil palavras por blocos.
5. **Demonstrações.** O caminho de amostra aplica uma espera de quatro segundos no frontend. Isso não prova que a demonstração tenha saída pré-calculada, nem que seus escores sejam falsos; também não constitui um benchmark independente.
6. **Teste com entrada própria.** Foi digitado um parágrafo original de teste de 91 palavras sobre bibliotecas e acionado Humanize. A interface mostrou um diálogo de cadastro para liberar palavras gratuitas. Não foi obtida uma saída reescrita nem pontuação de detector para essa entrada. Não houve criação de conta ou conclusão de CAPTCHA.

## O que não foi descoberto

Não foram identificados pesos, tokenizer, modelo base, dados de treino, ajuste fino, prompt do servidor, parâmetros de amostragem ou algoritmo de avaliação da saída. Os scripts inspecionados não fornecem o motor necessário para uma réplica exata. A documentação comercial menciona um modelo de linguagem, sem estabelecer esses detalhes.

## Consequência para o AVATAR

O motor continua sendo a integração DeepSeek configurada no AVATAR. Não foi substituído por um suposto modelo extraído do Uncheck. Os controles e a arquitetura de processamento podem ser reproduzidos; a identidade das saídas não foi estabelecida.

Não existe nesta investigação evidência para prometer 100% ou 99% de classificação humana, nem equivalência de desempenho ao Uncheck. Qualquer medição precisa especificar detector, versão, idioma, corpus, dados originais e resultados. Pontuação de um detector não é porcentagem objetiva de autoria humana. A ausência de credencial de inferência no ambiente local também impede validar a qualidade editorial do AVATAR com chamadas reais.

## Fontes e evidências

- Página e alegações comerciais: https://uncheck.ai/
- Contrato de geração e consulta: https://cdn.uncheck.ai/web-cdn/bypass/_next/static/chunks/0v1dq1-l0b_yb.js (cópia local, linhas 2352, 2384, 2532).
- Alias de modelo: https://cdn.uncheck.ai/web-cdn/bypass/_next/static/chunks/13njtmexu~ebn.js (cópia local, linhas 368–400).
- REA, carregamento: `ev_6852091deb86dc8166f5e40e1368aafdd58568de1749ef5bd9a1d391e50ff4a7`.
- REA, tentativa com texto próprio e diálogo de cadastro: `ev_5fd33282643a8a117bd4c23de054588e17417401b0a6f7671af013b4538a4558`.
- Manifesto: `C:\Users\luiz\uncheck-research\manifest.json`.
- Captura exportada: `C:\Users\luiz\uncheck-research\runtime-evidence-complete.json`.
