import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  role:                        { type: String, required: true, enum: ['CSO', 'TL', 'Supervisor'], index: true },
  competency_type:             { type: String, required: true, enum: ['Correspondence', 'Core', 'Functional', 'Leadership'] },
  sequence:                    { type: Number, required: true },
  name:                        { type: String, required: true },
  short_description:           { type: String, default: '' },
  bullet_points:               [String],
  target_level:                { type: String, enum: ['Basic', 'Intermediate', 'Advanced'], required: true },
  measurable_from_correspondence: { type: Boolean, required: true },
  applicable_roles:            [String],
  assessment_method:           { type: String, enum: ['correspondence_data', 'manual_assessment'], required: true },
}, { timestamps: true });

// Unique per (role, name) — upsert key
schema.index({ role: 1, name: 1 }, { unique: true });

export default mongoose.model('CompetencyFramework', schema, 'competency_framework');
