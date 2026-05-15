import mongoose from 'mongoose';

/**
 * Cache AI-generated content per officer × uploadDate × competency × type.
 * TTL: 7 days (automatically deleted by MongoDB TTL index).
 */
const schema = new mongoose.Schema({
  officerId:       { type: String, required: true },
  uploadDate:      { type: String, required: true },  // YYYY-MM-DD of latest upload
  competencyIndex: { type: Number, required: true },  // 0-5
  type:            { type: String, required: true, enum: ['development', 'evidence', 'corr-dev', 'corr-ev', 'func-dev', 'func-ev', 'lead-dev', 'lead-ev', 'scores', 'func-score', 'lead-score'] },
  content:         { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt:       { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 },
});

schema.index({ officerId: 1, uploadDate: 1, competencyIndex: 1, type: 1 }, { unique: true });

export default mongoose.models.AiCache ?? mongoose.model('AiCache', schema);
