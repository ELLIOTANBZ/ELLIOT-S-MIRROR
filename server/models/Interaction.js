import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  officerId:  { type: String, required: true, index: true },
  uploadDate: { type: String, required: true, index: true },
}, { strict: false, timestamps: true });

export default mongoose.model('Interaction', schema);
