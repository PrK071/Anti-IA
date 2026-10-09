import { APP_CONFIG } from '../config.js';

const normalizeText = (text) => String(text ?? '').normalize('NFC');
const unique = (items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

export function countWords(text) {
  const normalized = normalizeText(text).trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

export function countText(text) {
  const normalized = normalizeText(text);
  return {
    words: countWords(normalized),
    characters: normalized.length
  };
}

export function validateText(text, limits = APP_CONFIG.textLimits) {
  const normalized = normalizeText(text);
  const counts = countText(normalized);
  const warnings = [];

  if (!normalized.trim()) {
    return { valid: false, code: 'EMPTY_TEXT', message: 'Insira um texto antes de continuar.', counts, warnings };
  }

  if (Number.isFinite(limits.maxWords) && counts.words > limits.maxWords) {
    return {
      valid: false,
      code: 'WORD_LIMIT_EXCEEDED',
      message: `O texto excede o limite configurado de ${limits.maxWords.toLocaleString('pt-BR')} palavras.`,
      counts,
      warnings
    };
  }

  if (Number.isFinite(limits.maxCharacters) && counts.characters > limits.maxCharacters) {
    return {
      valid: false,
      code: 'CHARACTER_LIMIT_EXCEEDED',
      message: `O texto excede o limite técnico de ${limits.maxCharacters.toLocaleString('pt-BR')} caracteres.`,
      counts,
      warnings
    };
  }

  if (Number.isFinite(limits.maxCharacters) && counts.characters >= limits.maxCharacters * limits.warningThreshold) {
    warnings.push(`Você está próximo do limite técnico de ${limits.maxCharacters.toLocaleString('pt-BR')} caracteres.`);
  }
  if (Number.isFinite(limits.maxWords) && counts.words >= limits.maxWords * limits.warningThreshold) {
    warnings.push(`Você está próximo do limite configurado de ${limits.maxWords.toLocaleString('pt-BR')} palavras.`);
  }

  return { valid: true, code: 'VALID', message: '', counts, warnings };
}

export function extractTextFacts(text) {
  const normalized = normalizeText(text);
  return {
    numbers: unique(normalized.match(/(?:R\$|US\$|€|£)?\s?[-+]?\d+(?:[.,]\d+)*(?:\s?%|\s?[a-zA-Z]{1,4})?/gu) || []),
    dates: unique(normalized.match(/\b(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+de\s+[\p{L}]+\s+de\s+\d{4})\b/giu) || []),
    references: unique(normalized.match(/(?:\[[^\]\n]{1,80}\]|\([^()\n]*(?:\d{4}|p\.\s?\d+)[^()\n]*\))/gu) || []),
    citations: unique(normalized.match(/[“”"'][^“”"'\n]{2,300}[“”"']/gu) || []),
    technicalTerms: unique(normalized.match(/\b(?:[A-ZÁÉÍÓÚÇ]{2,}[A-ZÁÉÍÓÚÇ0-9-]*|[a-z]+[A-Z][\p{L}\d]*|[\p{L}]+\d+[\p{L}\d-]*)\b/gu) || []),
    properNames: unique(normalized.match(/\b\p{Lu}\p{Ll}+(?:\s+(?:(?:da|de|do|das|dos|e)\s+)?\p{Lu}\p{Ll}+)+\b/gu) || [])
  };
}

function compareFactGroup(originalItems, rewrittenItems) {
  const rewrittenSet = new Set(rewrittenItems.map((item) => item.toLocaleLowerCase()));
  const missing = originalItems.filter((item) => !rewrittenSet.has(item.toLocaleLowerCase()));
  return { original: originalItems, rewritten: rewrittenItems, missing, preserved: missing.length === 0 };
}

export function compareTexts(original, rewritten) {
  const originalText = normalizeText(original);
  const rewrittenText = normalizeText(rewritten);
  const originalCounts = countText(originalText);
  const rewrittenCounts = countText(rewrittenText);
  const originalFacts = extractTextFacts(originalText);
  const rewrittenFacts = extractTextFacts(rewrittenText);
  const wordDelta = rewrittenCounts.words - originalCounts.words;
  const volumeChangePercent = originalCounts.words ? Math.round((wordDelta / originalCounts.words) * 100) : 0;

  return {
    original: originalCounts,
    rewritten: rewrittenCounts,
    wordDelta,
    volumeChangePercent,
    checks: {
      numbers: compareFactGroup(originalFacts.numbers, rewrittenFacts.numbers),
      dates: compareFactGroup(originalFacts.dates, rewrittenFacts.dates),
      references: compareFactGroup(originalFacts.references, rewrittenFacts.references),
      citations: compareFactGroup(originalFacts.citations, rewrittenFacts.citations),
      technicalTerms: compareFactGroup(originalFacts.technicalTerms, rewrittenFacts.technicalTerms),
      properNames: compareFactGroup(originalFacts.properNames, rewrittenFacts.properNames)
    },
    disclaimer: 'Estas verificações são determinísticas e não comprovam preservação semântica integral.'
  };
}
