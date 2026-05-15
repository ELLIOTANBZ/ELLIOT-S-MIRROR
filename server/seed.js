import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import User from './models/User.js';

const USERS = [
  { username: 'cso',        name: 'CSO',        role: 'CSO' },
  { username: 'tl',         name: 'TL',         role: 'TL' },
  { username: 'supervisor', name: 'Supervisor', role: 'Supervisor' },
];

await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected to MongoDB');

const hash = await bcrypt.hash('1234', 10);

for (const u of USERS) {
  await User.findOneAndUpdate(
    { username: u.username },
    { ...u, password: hash },
    { upsert: true, new: true }
  );
  console.log(`Upserted user: ${u.username} (${u.role})`);
}

console.log('Seed complete.');
await mongoose.disconnect();
