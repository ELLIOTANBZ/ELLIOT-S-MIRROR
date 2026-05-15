import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'cpf-dev-secret-2024';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const user = await User.findOne({ username: username.trim().toLowerCase() });
  if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid username or password.' });

  const token = jwt.sign(
    { id: user._id, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, user: { id: user._id, name: user.name, role: user.role } });
});

// POST /api/auth/verify
router.post('/verify', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
