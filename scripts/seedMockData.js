import 'dotenv/config';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import Interaction from '../server/models/Interaction.js';
import AuditRecord from '../server/models/AuditRecord.js';
import EssRecord from '../server/models/EssRecord.js';
import ParsedUpload from '../server/models/ParsedUpload.js';
import User from '../server/models/User.js';
import { parseInteractionRow, parseAuditRow, parseEssRow } from '../server/utils/parsers.js';

const JAN_FILE = "/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/CPF_Mock_Jan2026_D1_to_D31_BAD.xlsx";
const FEB_FILE = "/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/CPF_Mock_Feb2026_D1_to_D28_MIDRISE.xlsx";
const MAR_FILE = "/Users/wongxinping/Documents/SUTD Y3T6/System Design Studio/CPF/dataset/CPF_Mock_Mar2026_D1_to_D31_ADVANCED.xlsx";

const MONGODB_URI = process.env.MONGODB_URI;

/** Parse day number and sheet type from sheet name. Returns null if no match. */
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

/** Map (month, dayN) → "YYYY-MM-DD" string. */
function dayToDate(month, dayN) {
  return `2026-${String(month).padStart(2, '0')}-${String(dayN).padStart(2, '0')}`;
}

/**
 * Read all sheets from an XLSX workbook and group rows by day and type.
 * Returns: Map<dayN, { interactions: rows[], auditmate: rows[], ess: rows[] }>
 */
function parseWorkbook(filePath) {
  const wb = XLSX.readFile(filePath);
  const days = new Map();

  for (const sheetName of wb.SheetNames) {
    const info = classifySheet(sheetName);
    if (!info) continue;

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) continue;

    if (!days.has(info.day)) {
      days.set(info.day, { interactions: [], auditmate: [], ess: [] });
    }
    days.get(info.day)[info.type] = rows;
  }

  return days;
}

/** Insert one day's data into MongoDB. Returns true if any data was inserted. */
async function seedDay(officerId, uploadDate, rows) {
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

/** Seed one full month from a workbook. Returns count of days seeded. */
async function seedMonth(officerId, filePath, month, maxDay, monthName) {
  const days = parseWorkbook(filePath);
  process.stdout.write(`Seeding ${monthName}... `);
  let count = 0;

  for (const [dayN, rows] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
    if (dayN < 1 || dayN > maxDay) continue;
    const uploadDate = dayToDate(month, dayN);
    const ok = await seedDay(officerId, uploadDate, rows);
    if (ok) {
      process.stdout.write(`D${dayN} done, `);
      count++;
    }
  }

  console.log(`\n${monthName} complete: ${count} days seeded`);
  return count;
}

async function main() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI not set in environment');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const csoUser = await User.findOne({ role: 'CSO' }).lean();
  if (!csoUser) throw new Error('No CSO user found in the users collection');
  const officerId = String(csoUser._id);
  console.log(`Using CSO officer: ${csoUser.name} (${officerId})\n`);

  // ── Wipe ALL existing data for this officer ──────────────────────
  const db = mongoose.connection.db;
  await db.collection('interactions').deleteMany({ officerId });
  await db.collection('auditmates').deleteMany({ officerId });
  await db.collection('esses').deleteMany({ officerId });
  await ParsedUpload.deleteMany({ officerId });
  console.log('Cleared ALL existing mock data for CSO officer\n');

  // ── Seed Jan, Feb, Mar ───────────────────────────────────────────
  await seedMonth(officerId, JAN_FILE, 1, 31, 'January');
  await seedMonth(officerId, FEB_FILE, 2, 28, 'February');
  await seedMonth(officerId, MAR_FILE, 3, 31, 'March');

  console.log('\nAll mock data seeded successfully');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
