import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import authRouter from './routes/auth.js';
import uploadRouter    from './routes/upload.js';
import dashboardRouter from './routes/dashboard.js';
import usersRouter     from './routes/users.js';
import overrideRouter  from './routes/override.js';
import competencyRouter from './routes/competencyBreakdown.js';
import aiRouter         from './routes/aiInsights.js';
import radarRouter      from './routes/radarData.js';
import flagsRouter      from './routes/flagsAlerts.js';
import teamOverviewRouter from './routes/teamOverview.js';
import competenciesRouter from './routes/competencies.js';
import adminRouter from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

app.use('/api/auth',      authRouter);
app.use('/api/upload',    uploadRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/users',     usersRouter);
app.use('/api/override',          overrideRouter);
app.use('/api/competency-breakdown', competencyRouter);
app.use('/api/ai',                   aiRouter);
app.use('/api/radar',                radarRouter);
app.use('/api/flags-alerts',         flagsRouter);
app.use('/api/team-overview',        teamOverviewRouter);
app.use('/api/competencies',         competenciesRouter);
app.use('/api/admin',         adminRouter);

// Health check
app.get('/api/health', (_req, res) => {
  const status = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({ status, db: status });
});

// Serve built React frontend in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
