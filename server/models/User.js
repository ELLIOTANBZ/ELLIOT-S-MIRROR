import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true },
  password:  { type: String, required: true },   // bcrypt hash
  name:      { type: String, required: true },
  role:      { type: String, enum: ['CSO', 'TL', 'Supervisor', 'Admin'], required: true },
});

export default mongoose.model('User', userSchema);
