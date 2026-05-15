import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/* Simple override log schema */
const overrideSchema = new mongoose.Schema({
  officerId:   { type: String, required: true, index: true },
  score:       { type: Number, required: true },
  reason:      { type: String, required: true },
  overriddenBy:{ type: String, required: true },  // supervisor id
  overriddenByName: String,
}, { timestamps: true });

const Override = mongoose.models.Override ?? mongoose.model('Override', overrideSchema);

/* POST /api/override — Supervisor only */
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'Supervisor') {
    return res.status(403).json({ error: 'Only Supervisors can override scores.' });
  }
  const { officerId, score, reason } = req.body;
  if (!officerId || score == null || !reason?.trim()) {
    return res.status(400).json({ error: 'officerId, score and reason are required.' });
  }
  try {
    const record = await Override.create({
      officerId,
      score,
      reason: reason.trim(),
      overriddenBy: req.user.id,
      overriddenByName: req.user.name,
    });
    res.json({ success: true, id: record._id });
  } catch (err) {
    console.error('Override error:', err);
    res.status(500).json({ error: 'Failed to save override.' });
  }
});

export default router;
