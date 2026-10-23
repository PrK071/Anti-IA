export const APP_CONFIG = Object.freeze({
  textLimits: Object.freeze({
    // Limite por documento. O cliente envia blocos menores ao servidor.
    maxWords: 50000,
    maxCharacters: 2000000,
    warningThreshold: 0.9
  }),
  supportedLanguages: Object.freeze(['pt-BR', 'pt-PT', 'en-US', 'es', 'fr-FR', 'de-DE', 'it-IT'])
});

export const PROCESSING_MODES = Object.freeze({
  instant: Object.freeze({
    id: 'instant',
    label: 'Instantâneo',
    description: 'Ajustes moderados com prioridade para rapidez e clareza.',
    rewriteDepth: 'moderate',
    semanticFidelity: 'high',
    preserveStructure: true
  }),
  advanced: Object.freeze({
    id: 'advanced',
    label: 'Avançado',
    description: 'Análise contextual aprofundada de frases, ideias e conexões.',
    rewriteDepth: 'deep',
    semanticFidelity: 'high',
    preserveStructure: false
  }),
  precise: Object.freeze({
    id: 'precise',
    label: 'Preciso',
    description: 'Máxima fidelidade, com mudanças somente quando necessárias.',
    rewriteDepth: 'minimal',
    semanticFidelity: 'maximum',
    preserveStructure: true
  })
});
