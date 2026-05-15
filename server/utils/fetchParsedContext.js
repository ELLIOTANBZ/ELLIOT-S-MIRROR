import ParsedUpload from '../models/ParsedUpload.js';

/**
 * Fetch pre-parsed sentence arrays for an officer from the last 30 days and
 * assemble a structured context block ready to embed in any AI prompt.
 *
 * @param {string} officerId
 * @param {string} [cutoffDate]  YYYY-MM-DD — if omitted, defaults to 30 days ago
 * @param {string} [today]       YYYY-MM-DD — if omitted, defaults to today
 * @returns {{ auditmateSentences, interactionsSentences, essSentences, contextBlock }}
 */
export async function fetchParsedContext(officerId, cutoffDate, today) {
  const now = new Date();
  const todayStr   = today      ?? now.toISOString().slice(0, 10);
  const cutoffStr  = cutoffDate ?? (() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  const dateFilter = { $gte: cutoffStr, $lte: todayStr };

  const [auditDocs, interactionDocs, essDocs] = await Promise.all([
    ParsedUpload.find({ officerId, type: 'auditmate',     uploadDate: dateFilter }).sort({ uploadDate: -1 }).lean(),
    ParsedUpload.find({ officerId, type: 'interactions',  uploadDate: dateFilter }).sort({ uploadDate: -1 }).lean(),
    ParsedUpload.find({ officerId, type: 'ess',           uploadDate: dateFilter }).sort({ uploadDate: -1 }).lean(),
  ]);

  // Flatten sentences — most recent upload date first (due to sort above)
  const auditmateSentences     = auditDocs.flatMap(d => d.sentences);
  const interactionsSentences  = interactionDocs.flatMap(d => d.sentences);
  const essSentences           = essDocs.flatMap(d => d.sentences);

  const sections = [];
  if (auditmateSentences.length) {
    sections.push(
      `Here is the officer's recent Auditmate performance data:\n\n${auditmateSentences.join('\n\n')}`
    );
  }
  if (interactionsSentences.length) {
    sections.push(
      `Here are the officer's recent member interactions:\n\n${interactionsSentences.join('\n')}`
    );
  }
  if (essSentences.length) {
    sections.push(
      `Here is member satisfaction feedback:\n\n${essSentences.join('\n')}`
    );
  }

  let contextBlock = sections.join('\n\n');

  // Truncate to ~3000 words to avoid token overflow (most recent already first)
  const words = contextBlock.split(/\s+/);
  if (words.length > 3000) {
    contextBlock = words.slice(0, 3000).join(' ') + '\n[Context truncated to 3000 words]';
  }

  return { auditmateSentences, interactionsSentences, essSentences, contextBlock };
}
