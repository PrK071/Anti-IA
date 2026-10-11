import { APP_CONFIG } from '../config.js';
import { validateText } from './text-analysis.js';

export const DETECTION_LABELS = Object.freeze({ human: 'Humano', mixed: 'Misto', ai: 'IA' });
export const MIN_DETECTION_CHARACTERS = 250;

export function validateDetectionText(text, limits = APP_CONFIG.textLimits) {
  const validation = validateText(text, limits);
  if (!validation.valid) return validation;
  if (text.trim().length < MIN_DETECTION_CHARACTERS) {
    return { ...validation, valid: false, code: 'TEXT_TOO_SHORT', message: 'Insira pelo menos 250 caracteres para verificar IA.' };
  }
  return validation;
}

export function validScores(scores) {
  return scores && ['human', 'mixed', 'ai'].every((key) => typeof scores[key] === 'number' && Number.isFinite(scores[key]) && scores[key] >= 0 && scores[key] <= 1)
    && Math.abs(scores.human + scores.mixed + scores.ai - 1) < 0.02;
}

export function validDetectionReport(report, text) {
  return report?.status === 'completed'
    && ['deepseek', 'gptzero'].includes(report.provider)
    && Object.hasOwn(DETECTION_LABELS, report.classification)
    && ['high', 'medium', 'low'].includes(report.confidence)
    && report.scoreKind === (report.provider === 'gptzero' ? 'detector_probability' : 'model_assessment')
    && validScores(report.scores)
    && Number.isInteger(report.wordCount) && report.wordCount > 0
    && typeof report.summary === 'string' && report.summary.length <= 3000
    && typeof report.model === 'string' && report.model.length <= 100
    && typeof report.analyzedAt === 'string' && Number.isFinite(Date.parse(report.analyzedAt))
    && Array.isArray(report.highlights) && report.highlights.length <= text.length
    && report.highlights.every((item, index, all) => Number.isInteger(item.start) && Number.isInteger(item.end)
      && item.start >= 0 && item.end > item.start && item.end <= text.length
      && (index === 0 || item.start >= all[index - 1].end)
      && typeof item.reason === 'string' && item.reason.length <= 500);
}

// Retain offsets into the full original, including whitespace and Unicode.
export function segmentDetectionText(text) {
  const segments = [...new Intl.Segmenter('pt', { granularity: 'sentence' }).segment(text)]
    .filter((item) => item.segment.trim());
  // Limit JSON output size; merge adjacent sentences for very long documents.
  const groupSize = Math.max(1, Math.ceil(segments.length / 200));
  const groups = [];
  for (let index = 0; index < segments.length; index += groupSize) {
    const first = segments[index];
    const start = index === 0 ? 0 : first.index;
    const end = segments[index + groupSize]?.index ?? text.length;
    groups.push({ id: groups.length, start, end, text: text.slice(start, end) });
  }
  return groups;
}
