import 'dotenv/config';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import User from '../server/models/User.js';
import Interaction from '../server/models/Interaction.js';
import AuditRecord from '../server/models/AuditRecord.js';
import EssRecord from '../server/models/EssRecord.js';
import ParsedUpload from '../server/models/ParsedUpload.js';
import { parseInteractionRow, parseAuditRow, parseEssRow } from '../server/utils/parsers.js';

/* ── Dataset file paths ─────────────────────────────────────────── */
const FILES = {
  bad: [
    { path: '/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/cpf_mock_jan2026badtomid.xlsx', month: 1, maxDay: 31, label: 'January' },
    { path: '/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/cpf_mock_feb2026badtomid.xlsx', month: 2, maxDay: 28, label: 'February' },
    { path: '/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/cpf_mock_mar2026badtomid.xlsx', month: 3, maxDay: 31, label: 'March' },
  ],
  good: [
    { path: '/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/cpf_mock_jan2026midtogood.xlsx', month: 1, maxDay: 31, label: 'January' },
    { path: '/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/cpf_mock_feb2026midtogood.xlsx', month: 2, maxDay: 28, label: 'February' },
    { path: '/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/cpf_mock_mar2026midtogood.xlsx', month: 3, maxDay: 31, label: 'March' },
  ],
};

/* ── Sheet name classifier ──────────────────────────────────────── */
function classifySheet(name) {
  let m;
  m = name.match(/^d(\d+)\s+or\b/i);
  if (m) return { day: parseInt(m[1], 10), type: 'interactions' };
  m = name.match(/^d(\d+)\s+auditmate\b/i);
  if (m) return { day: parseInt(m[1], 10), type: 'auditmate' };
  m = name.match(/^d(\d+)\s+ess\b/i);
  if (m) return { day: parseInt(m[1], 10), type: 'ess' };
  return null;
}

/* ── Date formatter ─────────────────────────────────────────────── */
function dayToDate(month, dayN) {
  return `2026-${String(month).padStart(2, '0')}-${String(dayN).padStart(2, '0')}`;
}

/* ── Parse workbook → Map<dayN, { interactions, auditmate, ess }> ─ */
function parseWorkbook(filePath) {
  const wb = XLSX.readFile(filePath);
  const days = new Map();
  for (const sheetName of wb.SheetNames) {
    const info = classifySheet(sheetName);
    if (!info) continue;
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) continue;
    if (!days.has(info.day)) days.set(info.day, { interactions: [], auditmate: [], ess: [] });
    days.get(info.day)[info.type] = rows;
  }
  return days;
}

/* ── Seed one day's worth of data ───────────────────────────────── */
async function seedDay(officerId, existingCSOId, uploadDate, rows) {
  if (String(officerId) === String(existingCSOId)) {
    console.error('SAFEGUARD: Attempted to seed data for existing CSO account. Aborting.');
    process.exit(1);
  }

  const { interactions, auditmate, ess } = rows;
  let insertedAny = false;

  if (interactions.length) {
    const docs = interactions.map(row => ({ ...row, officerId, uploadDate }));
    await Interaction.insertMany(docs, { ordered: false }).catch(() => {});
    const sentences = interactions.map(r => parseInteractionRow(r, uploadDate)).filter(Boolean);
    if (sentences.length) {
      await ParsedUpload.findOneAndUpdate(
        { officerId, uploadDate, type: 'interactions' },
        { $set: { sentences } },
        { upsert: true }
      );
    }
    insertedAny = true;
  }

  if (auditmate.length) {
    const docs = auditmate.map(row => ({ ...row, officerId, uploadDate }));
    await AuditRecord.insertMany(docs, { ordered: false }).catch(() => {});
    const sentences = auditmate.map(r => parseAuditRow(r, uploadDate)).filter(Boolean);
    if (sentences.length) {
      await ParsedUpload.findOneAndUpdate(
        { officerId, uploadDate, type: 'auditmate' },
        { $set: { sentences } },
        { upsert: true }
      );
    }
    insertedAny = true;
  }

  if (ess.length) {
    const docs = ess.map(row => ({ ...row, officerId, uploadDate }));
    await EssRecord.insertMany(docs, { ordered: false }).catch(() => {});
    const sentences = ess.map(r => parseEssRow(r, uploadDate)).filter(Boolean);
    if (sentences.length) {
      await ParsedUpload.findOneAndUpdate(
        { officerId, uploadDate, type: 'ess' },
        { $set: { sentences } },
        { upsert: true }
      );
    }
    insertedAny = true;
  }

  return insertedAny;
}

/* ── Seed one month from a file ─────────────────────────────────── */
async function seedMonth(officerId, existingCSOId, filePath, month, maxDay, label, officerLabel) {
  const days = parseWorkbook(filePath);
  process.stdout.write(`Seeding ${officerLabel} ${label}... `);
  let count = 0;

  for (const [dayN, rows] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
    if (dayN < 1 || dayN > maxDay) continue;
    const uploadDate = dayToDate(month, dayN);
    const ok = await seedDay(officerId, existingCSOId, uploadDate, rows);
    if (ok) {
      process.stdout.write(`D${dayN} done, `);
      count++;
    }
  }

  console.log(`\n${officerLabel} ${label} complete: ${count} days seeded`);
  return count;
}

/* ── Main ───────────────────────────────────────────────────────── */
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set in environment');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  /* ── SAFEGUARD: identify existing CSO to protect ─────────────── */
  const existingCSO = await User.findOne({
    role: 'CSO',
    username: { $nin: ['cso.bad', 'cso.good'] },
  }).lean();
  if (!existingCSO) throw new Error('No existing CSO user found to protect. Aborting.');
  const existingCSOId = String(existingCSO._id);
  console.log(`Existing CSO account protected: ${existingCSOId} (${existingCSO.username})\n`);

  /* ── STEP 1: Create / recreate the two users ─────────────────── */
  console.log('Creating users...');

  // Remove stale accounts if present
  await User.deleteMany({ username: { $in: ['cso.bad', 'cso.good'] } });

  const passwordHash = await bcrypt.hash('1234', 10);

  const badUser = await User.create({
    username: 'cso.bad',
    password: passwordHash,
    name: 'Officer Bad',
    role: 'CSO',
  });
  console.log(`cso.bad created: ${badUser._id}`);

  const goodUser = await User.create({
    username: 'cso.good',
    password: passwordHash,
    name: 'Officer Good',
    role: 'CSO',
  });
  console.log(`cso.good created: ${goodUser._id}\n`);

  const badId  = String(badUser._id);
  const goodId = String(goodUser._id);

  // Verify neither matches the protected ID (belt-and-braces)
  if (badId === existingCSOId || goodId === existingCSOId) {
    console.error('SAFEGUARD: New user ID collides with existing CSO. Aborting.');
    process.exit(1);
  }

  /* ── STEP 2: Clear any leftover data for these two IDs ───────── */
  const db = mongoose.connection.db;
  for (const officerId of [badId, goodId]) {
    if (String(officerId) === existingCSOId) {
      console.error('SAFEGUARD: Attempted to delete data for existing CSO account. Aborting.');
      process.exit(1);
    }
    await db.collection('interactions').deleteMany({ officerId });
    await db.collection('auditmates').deleteMany({ officerId });
    await db.collection('esses').deleteMany({ officerId });
    await ParsedUpload.deleteMany({ officerId });
  }
  console.log('Cleared any existing data for cso.bad and cso.good\n');

  /* ── STEP 3: Seed cso.bad ────────────────────────────────────── */
  for (const { path, month, maxDay, label } of FILES.bad) {
    await seedMonth(badId, existingCSOId, path, month, maxDay, label, 'cso.bad');
  }

  /* ── STEP 4: Seed cso.good ───────────────────────────────────── */
  for (const { path, month, maxDay, label } of FILES.good) {
    await seedMonth(goodId, existingCSOId, path, month, maxDay, label, 'cso.good');
  }

  console.log('\nAll done. 2 officers seeded successfully.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
