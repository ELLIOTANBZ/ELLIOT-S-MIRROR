import mongoose from 'mongoose';

/**
 * Stores pre-parsed human-readable sentences generated from raw CSV rows at upload time.
 * One document per (officerId, uploadDate, type) — upserted on each upload.
 * type: 'interactions' | 'auditmate' | 'ess'
 */
const schema = new mongoose.Schema({
  officerId:  { type: String, required: true, index: true },
  uploadDate: { type: String, required: true, index: true },
  type:       { type: String, enum: ['interactions', 'auditmate', 'ess'], required: true },
  sentences:  [String],
}, { timestamps: true });

schema.index({ officerId: 1, uploadDate: 1, type: 1 }, { unique: true });

export default mongoose.models.ParsedUpload
  ?? mongoose.model('ParsedUpload', schema);
