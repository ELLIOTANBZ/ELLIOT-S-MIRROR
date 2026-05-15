import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import CompetencyFramework from '../models/CompetencyFramework.js';

const router = Router();

// GET /api/competencies?role=CSO|TL|Supervisor
router.get('/', requireAuth, async (req, res) => {
  try {
    const role = req.query.role ?? req.user.role;
    const competencies = await CompetencyFramework
      .find({ role })
      .sort({ competency_type: 1, sequence: 1 })
      .lean();

    res.json({ competencies, hasFramework: competencies.length > 0 });
  } catch (err) {
    console.error('Competencies error:', err);
    res.status(500).json({ error: 'Failed to load competency framework.' });
  }
});

export default router;
