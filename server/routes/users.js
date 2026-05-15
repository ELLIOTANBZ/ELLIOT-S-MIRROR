import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';

const router = Router();

/**
 * GET /api/users/team
 * Returns the list of officers this user can "view as":
 *   CSO        → [] (locked to own account)
 *   TL         → all CSOs
 *   Supervisor → all CSOs + all TLs
 */
router.get('/team', requireAuth, async (req, res) => {
  const { role } = req.user;
  console.log('Team API called - User role:', role, 'User name:', req.user.name);
  try {
    let filter = {};
    if (role === 'CSO') return res.json([]);
    if (role === 'TL') filter = { role: 'CSO' };
    if (role === 'Supervisor') filter = { role: { $in: ['CSO', 'TL'] } };
    if (role === 'Admin') filter = { role: { $ne: 'Admin' } }; // Admin doesn't see team members

    const users = await User.find(filter, '_id name role').lean();
    console.log('Team API result - Found users:', users.length);
    users.forEach(user => console.log('  -', user.name, 'Role:', user.role));
    res.json(users.map(u => ({ id: String(u._id), name: u.name, role: u.role })));
  } catch (err) {
    console.error('Team fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch team members.' });
  }
});

export default router;
