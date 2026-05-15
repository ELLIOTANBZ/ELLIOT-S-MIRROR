import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import Interaction from '../models/Interaction.js';
import AuditRecord from '../models/AuditRecord.js';
import EssRecord from '../models/EssRecord.js';
import ParsedUpload from '../models/ParsedUpload.js';
import { parseInteractionRow, parseAuditRow, parseEssRow } from '../utils/parsers.js';

const router = Router();

const SKIP = new Set(['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt']);

function extractAuditScore(record) {
  const tryParse = v => {
    const n = parseFloat(String(v ?? '').replace('%', ''));
    return !isNaN(n) && n >= 0 && n <= 100 ? n : null;
  };
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if ((low.includes('score') || low.includes('total') || low.includes('percentage') || low === '%') && !low.includes('indicator')) {
      const n = tryParse(v); if (n !== null) return n;
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const n = tryParse(v); if (n !== null) return n;
  }
  return null;
}

function extractClassification(record) {
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('classif') || low.includes('issue') || low.includes('type') || low.includes('category') || low.includes('outcome')) {
      return String(v ?? '').toLowerCase().trim();
    }
  }
  return null;
}

function extractRating(record) {
  const tryParse = v => {
    const n = parseFloat(String(v ?? ''));
    return !isNaN(n) && n >= 1 && n <= 5 ? n : null;
  };
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const low = k.toLowerCase();
    if (low.includes('rating') || low.includes('satisfaction') || low.includes('ess') || low.includes('score')) {
      const n = tryParse(v); if (n !== null) return n;
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (SKIP.has(k)) continue;
    const n = tryParse(v); if (n !== null) return n;
  }
  return null;
}

// GET /api/upload/summary?date=YYYY-MM-DD
router.get('/summary', requireAuth, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const officerId = req.user.id;

  try {
    const [interactions, auditRecords, essRecords] = await Promise.all([
      Interaction.find({ officerId, uploadDate: date }).lean(),
      AuditRecord.find({ officerId, uploadDate: date }).lean(),
      EssRecord.find({ officerId, uploadDate: date }).lean(),
    ]);

    // Interactions
    const interactionsSummary = { count: interactions.length };

    // Auditmate
    const auditScores = auditRecords.map(extractAuditScore).filter(s => s !== null);
    const auditAvg    = auditScores.length ? auditScores.reduce((a, b) => a + b, 0) / auditScores.length : null;
    const cls = { noIssue: 0, minorIssue: 0, majorIssue: 0, other: 0 };
    for (const rec of auditRecords) {
      const c = extractClassification(rec);
      if (!c) continue;
      if (c.includes('no issue') || c === 'no' || c === 'none' || c === 'pass') cls.noIssue++;
      else if (c.includes('minor'))  cls.minorIssue++;
      else if (c.includes('major'))  cls.majorIssue++;
      else cls.other++;
    }
    const auditSummary = {
      count: auditRecords.length,
      avgScore: auditAvg !== null ? +auditAvg.toFixed(1) : null,
      classifications: cls,
    };

    // ESS
    const essRatings = essRecords.map(extractRating).filter(r => r !== null);
    const essAvg     = essRatings.length ? essRatings.reduce((a, b) => a + b, 0) / essRatings.length : null;
    const essSummary = {
      count: essRecords.length,
      avgRating: essAvg !== null ? +essAvg.toFixed(1) : null,
      positive: essRatings.filter(r => r >= 4).length,
      negative: essRatings.filter(r => r <= 2).length,
    };

    res.json({ date, interactions: interactionsSummary, auditmate: auditSummary, ess: essSummary });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to load summary.' });
  }
});

// GET /api/upload/user-summary?date=YYYY-MM-DD&officerId=xxx
router.get('/user-summary', requireAuth, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });

  let officerId = req.user.id;
  const requestedId = req.query.officerId;
  if (requestedId && String(requestedId) !== String(req.user.id)) {
    if (req.user.role === 'Admin') { officerId = requestedId; }
    else if (req.user.role === 'TL' || req.user.role === 'Supervisor') { officerId = requestedId; }
    else { return res.status(403).json({ error: 'Access denied.' }); }
  }

  try {
    const [interactions, auditRecords, essRecords] = await Promise.all([
      Interaction.find({ officerId, uploadDate: date }).lean(),
      AuditRecord.find({ officerId, uploadDate: date }).lean(),
      EssRecord.find({ officerId, uploadDate: date }).lean(),
    ]);

    const cards = [];

    if (interactions.length) {
      cards.push({ type: 'interactions', count: interactions.length, uploadDate: date });
    }

    if (auditRecords.length) {
      const scores = auditRecords.map(extractAuditScore).filter(s => s !== null);
      const avgScore = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;
      const majorIssues = auditRecords.filter(r => {
        const c = extractClassification(r);
        return c && c.includes('major');
      }).length;
      cards.push({ type: 'auditmate', count: auditRecords.length, avgScore, majorIssues, uploadDate: date });
    }

    if (essRecords.length) {
      const ratings = essRecords.map(extractRating).filter(r => r !== null);
      const avgRating = ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;
      cards.push({
        type: 'ess', count: essRecords.length, avgRating,
        positive: ratings.filter(r => r >= 4).length,
        negative: ratings.filter(r => r <= 2).length,
        uploadDate: date,
      });
    }

    res.json(cards);
  } catch (err) {
    console.error('User summary error:', err);
    res.status(500).json({ error: 'Failed to load summary.' });
  }
});

// POST /api/upload
router.post('/', requireAuth, async (req, res) => {
  const { date, interactions, auditmate, ess, targetUserId } = req.body;
  // Admin can upload on behalf of another user
  const officerId  = (req.user.role === 'Admin' && targetUserId) ? targetUserId : req.user.id;
  const uploadDate = date || new Date().toISOString().slice(0, 10);

  if (!interactions?.length && !auditmate?.length && !ess?.length) {
    return res.status(400).json({ error: 'At least one data source is required.' });
  }

  const inserted = {};

  try {
    // Prevent duplicate uploads for the same date
    const existing = await Promise.all([
      Interaction.countDocuments({ officerId, uploadDate }),
      AuditRecord.countDocuments({ officerId, uploadDate }),
      EssRecord.countDocuments({ officerId, uploadDate }),
    ]);
    if (existing.some(n => n > 0)) {
      return res.status(409).json({ error: 'Data already uploaded for this date. Delete the existing data first.' });
    }
    if (interactions?.length) {
      const docs = interactions.map(row => ({ ...row, officerId, uploadDate }));
      await Interaction.insertMany(docs, { ordered: false });
      inserted.interactions = docs.length;

      // Parse sentences and upsert into ParsedUpload
      const sentences = interactions
        .map(row => parseInteractionRow(row, uploadDate))
        .filter(Boolean);
      if (sentences.length) {
        await ParsedUpload.findOneAndUpdate(
          { officerId, uploadDate, type: 'interactions' },
          { $set: { sentences } },
          { upsert: true }
        );
      }
    }

    if (auditmate?.length) {
      const docs = auditmate.map(row => ({ ...row, officerId, uploadDate }));
      await AuditRecord.insertMany(docs, { ordered: false });
      inserted.auditmate = docs.length;

      // Parse sentences and upsert into ParsedUpload
      const sentences = auditmate
        .map(row => parseAuditRow(row, uploadDate))
        .filter(Boolean);
      if (sentences.length) {
        await ParsedUpload.findOneAndUpdate(
          { officerId, uploadDate, type: 'auditmate' },
          { $set: { sentences } },
          { upsert: true }
        );
      }
    }

    if (ess?.length) {
      const docs = ess.map(row => ({ ...row, officerId, uploadDate }));
      await EssRecord.insertMany(docs, { ordered: false });
      inserted.ess = docs.length;

      // Parse sentences and upsert into ParsedUpload
      const sentences = ess
        .map(row => parseEssRow(row, uploadDate))
        .filter(Boolean);
      if (sentences.length) {
        await ParsedUpload.findOneAndUpdate(
          { officerId, uploadDate, type: 'ess' },
          { $set: { sentences } },
          { upsert: true }
        );
      }
    }

    res.json({ success: true, inserted });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to save data.' });
  }
});

// DELETE /api/upload?date=YYYY-MM-DD  — remove all records for a date
router.delete('/', requireAuth, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });
  const officerId = req.user.id;

  try {
    const [i, a, e, p] = await Promise.all([
      Interaction.deleteMany({ officerId, uploadDate: date }),
      AuditRecord.deleteMany({ officerId, uploadDate: date }),
      EssRecord.deleteMany({ officerId, uploadDate: date }),
      ParsedUpload.deleteMany({ officerId, uploadDate: date }),
    ]);
    res.json({ success: true, deleted: {
      interactions: i.deletedCount,
      auditmate:    a.deletedCount,
      ess:          e.deletedCount,
      parsed:       p.deletedCount,
    }});
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete data.' });
  }
});

export default router;
