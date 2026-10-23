# Grubby: evidência observada e implementação no Anti IA

Inspeção em 23/10/2026 UTC de https://grubby.ai/, com navegador e REA. O pedido foi adaptar os fluxos do Grubby ao Anti IA.

## Interface e contrato observados

- Homepage com editor em duas colunas, painel de entrada branco, saída cinza, fundo escuro com malha, títulos em gradiente e controles de colagem, PDF, exemplo e modo.
- Seletor público: GPTZero, ZeroGPT e Academic (Turnitin). Esses nomes são perfis comerciais; não identificam um checkpoint de inferência.
- O bundle público `00vaeoyxm2e2c.js` contém caminhos `/api/humanizer-anonymous`, `/api/humanizer-queue`, `/api/humanizer-proxy` e `/api/humanizer-status`. Há envio de modo e processamento em etapas; o modo acadêmico solicita duas etapas. Referências a drafts e reescrita parcial também estão presentes no cliente. Isso não demonstra como o servidor implementa cada operação.
- O caminho de reescrita parcial contém o alias `sef750-e7`, `model: V1` e instruções de retorno restrito ao trecho. Não foi encontrado checkpoint, fornecedor verificável, pesos ou endpoint público independente correspondente ao alias. Não se pode atribuí-lo a DeepSeek, OpenAI ou outro fornecedor por semelhança.
- Uma execução do REA preencheu o editor com um texto próprio em inglês e clicou Humanize. A chamada POST para `/api/humanizer-anonymous` respondeu 403. Não houve saída de humanização para medir ou comparar. Nenhum login, pagamento ou contorno do bloqueio foi realizado.

## Entrega no Anti IA

Layout e controles reimplementados com código próprio, mantendo marca Anti IA, idiomas, importação, comparação, exportação e limite de 50.000 palavras. O fundo vetorial é original. Incluídos colar, exemplo, atalhos de estilo e reescrita de seleção com desfazer. As preferências detalhadas ficam em Ajustes finos. Os estilos Natural, Fluente e Acadêmico configuram os modos editoriais do Anti IA; não prometem pontuações de detectores.

O motor permanece a API DeepSeek já configurada. Não é uma cópia exata do algoritmo proprietário do Grubby e não contém seus pesos. Também não foram reproduzidos garantias comerciais, números de usuários, relatórios de detectores, autenticação ou cobranças do Grubby.

## Evidências e cobertura

- REA, carregamento: `ev_20e0e0ef69d6ec3b5249d4d82f221146fdef68ac743e98ddbe657adf572d6ad2`.
- REA, envio normal e resposta 403: `ev_771cd6e85efcaf08c66c586520903781496c81499be8e7eef4eb61fbfe074b9e`.
- Análise estática inicial: `ev_1fe114e28c2c46e569fd8ac2abc26a7d02c48947acf42a65dc31fad1d75dfc06`, três arquivos selecionados e cobertura parcial. Outros trechos foram lidos diretamente dos artefatos públicos.
- Manifesto local de 26 scripts, tamanhos e SHA-256: `C:/Users/luiz/grubby-research/manifest.json`. Scripts e capturas não são distribuídos no aplicativo.
- Fonte do contrato de edição: https://grubby.ai/_next/static/immutable/chunks/00vaeoyxm2e2c.js . Os achados descrevem os bytes inspecionados e podem mudar em versões futuras.
