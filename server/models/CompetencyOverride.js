import mongoose from 'mongoose';

/**
 * Stores manually-overridden competency levels per officer.
 * One document per officer (upserted). The `levels` map uses
 * competency index (0-5) as keys and level (1/2/3) as values.
 */
const schema = new mongoose.Schema({
  officerId:       { type: String, required: true, unique: true, index: true },
  levels:          { type: Map, of: Number, default: {} },  // { '0': 2, '3': 3, ... }
  overriddenBy:    { type: String, required: true },
  overriddenByName:{ type: String },
}, { timestamps: true });

export default mongoose.models.CompetencyOverride
  ?? mongoose.model('CompetencyOverride', schema);
