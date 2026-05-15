import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import Interaction from '../models/Interaction.js';
import AuditRecord from '../models/AuditRecord.js';
import EssRecord from '../models/EssRecord.js';
import ParsedUpload from '../models/ParsedUpload.js';
import CompetencyFramework from '../models/CompetencyFramework.js';
import User from '../models/User.js';

const router = Router();

// Admin-only middleware
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// GET /api/admin/uploads?date=YYYY-MM-DD
router.get('/uploads', requireAuth, requireAdmin, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });

  try {
    // Get all users for the date
    const users = await User.find({}).lean();
    const userIdToName = {};
    users.forEach(user => {
      userIdToName[user._id.toString()] = user.name;
    });

    // Get all data for the date
    const [interactions, auditRecords, essRecords] = await Promise.all([
      Interaction.find({ uploadDate: date }).lean(),
      AuditRecord.find({ uploadDate: date }).lean(),
      EssRecord.find({ uploadDate: date }).lean(),
    ]);

    const uploadData = [];

    // Process interactions
    const interactionsByOfficer = {};
    interactions.forEach(record => {
      const officerId = record.officerId;
      if (!interactionsByOfficer[officerId]) {
        interactionsByOfficer[officerId] = [];
      }
      interactionsByOfficer[officerId].push(record);
    });

    Object.entries(interactionsByOfficer).forEach(([officerId, records]) => {
      uploadData.push({
        officerId,
        officerName: userIdToName[officerId] || 'Unknown',
        type: 'interactions',
        count: records.length,
        uploadDate: date,
      });
    });

    // Process audit records
    const auditByOfficer = {};
    auditRecords.forEach(record => {
      const officerId = record.officerId;
      if (!auditByOfficer[officerId]) {
        auditByOfficer[officerId] = [];
      }
      auditByOfficer[officerId].push(record);
    });

    Object.entries(auditByOfficer).forEach(([officerId, records]) => {
      // Calculate average score
      const scores = [];
      records.forEach(record => {
        // Try to extract score from various fields
        for (const [key, value] of Object.entries(record)) {
          if (['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt'].includes(key)) continue;
          const lowerKey = key.toLowerCase();
          if ((lowerKey.includes('score') || lowerKey.includes('total') || lowerKey.includes('percentage') || lowerKey === '%') && !lowerKey.includes('indicator')) {
            const num = parseFloat(String(value || '').replace('%', ''));
            if (!isNaN(num) && num >= 0 && num <= 100) {
              scores.push(num);
              break;
            }
          }
        }
      });

      const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

      uploadData.push({
        officerId,
        officerName: userIdToName[officerId] || 'Unknown',
        type: 'auditmate',
        count: records.length,
        avgScore: avgScore ? Math.round(avgScore * 10) / 10 : null,
        uploadDate: date,
      });
    });

    // Process ESS records
    const essByOfficer = {};
    essRecords.forEach(record => {
      const officerId = record.officerId;
      if (!essByOfficer[officerId]) {
        essByOfficer[officerId] = [];
      }
      essByOfficer[officerId].push(record);
    });

    Object.entries(essByOfficer).forEach(([officerId, records]) => {
      // Calculate average rating
      const ratings = [];
      records.forEach(record => {
        for (const [key, value] of Object.entries(record)) {
          if (['_id', 'officerId', 'uploadDate', '__v', 'createdAt', 'updatedAt'].includes(key)) continue;
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('rating') || lowerKey.includes('satisfaction') || lowerKey.includes('ess') || lowerKey.includes('score')) {
            const num = parseFloat(String(value || ''));
            if (!isNaN(num) && num >= 1 && num <= 5) {
              ratings.push(num);
              break;
            }
          }
        }
      });

      const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

      uploadData.push({
        officerId,
        officerName: userIdToName[officerId] || 'Unknown',
        type: 'ess',
        count: records.length,
        avgRating: avgRating ? Math.round(avgRating * 10) / 10 : null,
        uploadDate: date,
      });
    });

    // Sort by officer name and type
    uploadData.sort((a, b) => {
      if (a.officerName !== b.officerName) {
        return a.officerName.localeCompare(b.officerName);
      }
      return a.type.localeCompare(b.type);
    });

    res.json(uploadData);
  } catch (err) {
    console.error('Admin uploads error:', err);
    res.status(500).json({ error: 'Failed to load upload data.' });
  }
});

// DELETE /api/admin/uploads?officerId=xxx&date=YYYY-MM-DD&type=interactions|auditmate|ess  (type optional, omit to delete all)
router.delete('/uploads', requireAuth, requireAdmin, async (req, res) => {
  const { officerId, date, type } = req.query;
  if (!officerId || !date) return res.status(400).json({ error: 'officerId and date are required' });

  try {
    const filter = { officerId, uploadDate: date };
    const deleted = {};

    if (!type || type === 'interactions') {
      const r = await Interaction.deleteMany(filter);
      deleted.interactions = r.deletedCount;
    }
    if (!type || type === 'auditmate') {
      const r = await AuditRecord.deleteMany(filter);
      deleted.auditmate = r.deletedCount;
    }
    if (!type || type === 'ess') {
      const r = await EssRecord.deleteMany(filter);
      deleted.ess = r.deletedCount;
    }
    // Also clean up parsed uploads
    if (type) {
      const r = await ParsedUpload.deleteMany({ officerId, uploadDate: date, type });
      deleted.parsed = r.deletedCount;
    } else {
      const r = await ParsedUpload.deleteMany({ officerId, uploadDate: date });
      deleted.parsed = r.deletedCount;
    }

    res.json({ success: true, deleted });
  } catch (err) {
    console.error('Admin delete uploads error:', err);
    res.status(500).json({ error: 'Failed to delete upload data.' });
  }
});

// GET /api/admin/competencies
router.get('/competencies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const competencies = await CompetencyFramework.find({}).sort({ role: 1, competency_type: 1, sequence: 1 });
    res.json(competencies);
  } catch (err) {
    console.error('Admin competencies error:', err);
    res.status(500).json({ error: 'Failed to load competencies.' });
  }
});

// POST /api/admin/competencies
router.post('/competencies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const competency = new CompetencyFramework(req.body);
    await competency.save();
    res.json({ success: true, competency });
  } catch (err) {
    console.error('Create competency error:', err);
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Competency with this name already exists for this role.' });
    }
    res.status(500).json({ error: 'Failed to create competency.' });
  }
});

// PUT /api/admin/competencies/:id
router.put('/competencies/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const competency = await CompetencyFramework.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!competency) {
      return res.status(404).json({ error: 'Competency not found.' });
    }
    
    res.json({ success: true, competency });
  } catch (err) {
    console.error('Update competency error:', err);
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Competency with this name already exists for this role.' });
    }
    res.status(500).json({ error: 'Failed to update competency.' });
  }
});

// DELETE /api/admin/competencies/:id
router.delete('/competencies/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const competency = await CompetencyFramework.findByIdAndDelete(req.params.id);
    
    if (!competency) {
      return res.status(404).json({ error: 'Competency not found.' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Delete competency error:', err);
    res.status(500).json({ error: 'Failed to delete competency.' });
  }
});

export default router;
