import 'dotenv/config';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = join(__dirname, '../dataset/Sample Competencies (Confidential).xlsx');
const MONGODB_URI = process.env.MONGODB_URI;

/* ── Schema (inline to avoid circular import) ──────────────────── */
const schema = new mongoose.Schema({
  role:                        { type: String, required: true },
  competency_type:             { type: String, required: true },
  sequence:                    { type: Number, required: true },
  name:                        { type: String, required: true },
  short_description:           { type: String, default: '' },
  bullet_points:               [String],
  target_level:                { type: String, required: true },
  measurable_from_correspondence: { type: Boolean, required: true },
  applicable_roles:            [String],
  assessment_method:           { type: String, required: true },
}, { timestamps: true });
schema.index({ role: 1, name: 1 }, { unique: true });
const CompetencyFramework = mongoose.model('CompetencyFramework', schema, 'competency_framework');

/* ── Cell parser ───────────────────────────────────────────────── */
function parseCell(text) {
  if (!text || !text.toString().trim()) return null;
  const clean = text.toString().replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const parts = clean.split('\n\n').map(p => p.trim()).filter(Boolean);
  const name = parts[0];
  if (!name) return null;

  let short_description = '';
  let bullet_points = [];

  const rest = parts.slice(1).join('\n\n').trim();
  if (!rest) return { name, short_description, bullet_points };

  if (rest.startsWith('•')) {
    bullet_points = rest.split('\n')
      .map(l => l.replace(/^[•\-]\s*/, '').trim())
      .filter(Boolean);
  } else {
    const lines = rest.split('\n');
    const bulletStart = lines.findIndex(l => l.trim().startsWith('•'));
    if (bulletStart === -1) {
      short_description = rest.replace(/\n/g, ' ').trim();
    } else {
      short_description = lines.slice(0, bulletStart).join(' ').trim();
      bullet_points = lines.slice(bulletStart)
        .map(l => l.replace(/^[•\-]\s*/, '').trim())
        .filter(Boolean);
    }
  }

  return { name, short_description, bullet_points };
}

/* ── Measurability config ──────────────────────────────────────── */
const MEASURABLE_FUNCTIONAL = new Set(['Case Management', 'Tech Application', 'Digital Design and Management']);

function functionalMeta(name) {
  const measurable = MEASURABLE_FUNCTIONAL.has(name);
  return {
    measurable_from_correspondence: measurable,
    assessment_method: measurable ? 'correspondence_data' : 'manual_assessment',
  };
}

/* ── Main seed function ────────────────────────────────────────── */
async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const wb   = XLSX.readFile(EXCEL_PATH);
  const ws   = wb.Sheets['Competencies'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const docs = [];

  /* ── CSO/TL rows: 1–6 ── */
  const csoTlRows = rows.slice(1, 7);  // rows index 1-6

  // Correspondence (col 2, rows 1-5)
  csoTlRows.slice(0, 5).forEach((row, i) => {
    const parsed = parseCell(row[2]);
    if (!parsed) return;
    const base = {
      competency_type: 'Correspondence',
      sequence: i + 1,
      name: parsed.name,
      short_description: parsed.short_description,
      bullet_points: parsed.bullet_points,
      measurable_from_correspondence: true,
      applicable_roles: ['CSO', 'TL', 'Supervisor'],
      assessment_method: 'correspondence_data',
    };
    docs.push({ ...base, role: 'CSO', target_level: 'Intermediate' });
    docs.push({ ...base, role: 'TL',  target_level: 'Advanced' });
  });

  // Core (col 3, rows 1-6)
  csoTlRows.forEach((row, i) => {
    const parsed = parseCell(row[3]);
    if (!parsed) return;
    const base = {
      competency_type: 'Core',
      sequence: i + 1,
      name: parsed.name,
      short_description: parsed.short_description,
      bullet_points: parsed.bullet_points,
      measurable_from_correspondence: true,
      applicable_roles: ['CSO', 'TL', 'Supervisor'],
      assessment_method: 'correspondence_data',
    };
    docs.push({ ...base, role: 'CSO', target_level: 'Intermediate' });
    docs.push({ ...base, role: 'TL',  target_level: 'Advanced' });
  });

  // Functional CSO/TL (col 4, rows 1-5)
  csoTlRows.slice(0, 5).forEach((row, i) => {
    const parsed = parseCell(row[4]);
    if (!parsed) return;
    const meta = functionalMeta(parsed.name);
    const base = {
      competency_type: 'Functional',
      sequence: i + 1,
      name: parsed.name,
      short_description: parsed.short_description,
      bullet_points: parsed.bullet_points,
      ...meta,
      applicable_roles: ['CSO', 'TL'],
    };
    docs.push({ ...base, role: 'CSO', target_level: 'Intermediate' });
    docs.push({ ...base, role: 'TL',  target_level: 'Advanced' });
  });

  /* ── Supervisor rows: 7–12 ── */
  const supervisorRows = rows.slice(7, 13); // rows index 7-12

  // Correspondence (col 2, rows 7-11) — same names/desc as CSO/TL
  csoTlRows.slice(0, 5).forEach((row, i) => {
    const parsed = parseCell(row[2]);
    if (!parsed) return;
    docs.push({
      role: 'Supervisor',
      competency_type: 'Correspondence',
      sequence: i + 1,
      name: parsed.name,
      short_description: parsed.short_description,
      bullet_points: parsed.bullet_points,
      target_level: 'Advanced',
      measurable_from_correspondence: true,
      applicable_roles: ['CSO', 'TL', 'Supervisor'],
      assessment_method: 'correspondence_data',
    });
  });

  // Core (col 3) — same as CSO/TL rows
  csoTlRows.forEach((row, i) => {
    const parsed = parseCell(row[3]);
    if (!parsed) return;
    docs.push({
      role: 'Supervisor',
      competency_type: 'Core',
      sequence: i + 1,
      name: parsed.name,
      short_description: parsed.short_description,
      bullet_points: parsed.bullet_points,
      target_level: 'Advanced',
      measurable_from_correspondence: true,
      applicable_roles: ['CSO', 'TL', 'Supervisor'],
      assessment_method: 'correspondence_data',
    });
  });

  // Functional Supervisor (col 4, rows 7-11) — different bullets
  supervisorRows.slice(0, 5).forEach((row, i) => {
    const parsed = parseCell(row[4]);
    if (!parsed) return;
    const meta = functionalMeta(parsed.name);
    docs.push({
      role: 'Supervisor',
      competency_type: 'Functional',
      sequence: i + 1,
      name: parsed.name,
      short_description: parsed.short_description,
      bullet_points: parsed.bullet_points,
      target_level: 'Advanced',
      ...meta,
      applicable_roles: ['Supervisor'],
    });
  });

  // Leadership Supervisor (col 5, rows 7-9)
  supervisorRows.slice(0, 3).forEach((row, i) => {
    const parsed = parseCell(row[5]);
    if (!parsed) return;
    docs.push({
      role: 'Supervisor',
      competency_type: 'Leadership',
      sequence: i + 1,
      name: parsed.name,
      short_description: parsed.short_description,
      bullet_points: parsed.bullet_points,
      target_level: 'Advanced',
      measurable_from_correspondence: false,
      applicable_roles: ['Supervisor'],
      assessment_method: 'manual_assessment',
    });
  });

  /* ── Upsert all docs ── */
  let ok = 0, fail = 0;
  for (const doc of docs) {
    try {
      await CompetencyFramework.findOneAndUpdate(
        { role: doc.role, name: doc.name },
        { $set: doc },
        { upsert: true, new: true }
      );
      console.log(`  ✓  [${doc.role}] ${doc.competency_type} #${doc.sequence}: ${doc.name}`);
      ok++;
    } catch (err) {
      console.error(`  ✗  [${doc.role}] ${doc.name}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\nDone. ${ok} upserted, ${fail} failed.`);
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
