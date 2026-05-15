import 'dotenv/config'
import mongoose from 'mongoose'

await mongoose.connect(process.env.MONGODB_URI)
const col = mongoose.connection.db.collection('competency_framework')

// Find CSO Core seq 1 & 2 duplicates
const candidates = await col.find({ role: 'CSO', competency_type: 'Core', sequence: { $lte: 2 } }).toArray()
console.log('\n=== CSO Core seq 1-2 records ===')
candidates.forEach(d => console.log(`  _id=${d._id}  seq=${d.sequence}  name="${d.name}"  desc="${(d.short_description||'').substring(0,50) || '(none)'}"`))

// Delete the short/bad duplicates
const del1 = await col.deleteOne({ role: 'CSO', competency_type: 'Core', name: 'Thinking Clearly and Sound Judgements' })
console.log(`\nDeleted "Thinking Clearly and Sound Judgements": ${del1.deletedCount}`)

const del2 = await col.deleteOne({ role: 'CSO', competency_type: 'Core', name: 'Working as a team' })
console.log(`Deleted "Working as a team": ${del2.deletedCount}`)

// Show remaining CSO Core records
const remaining = await col.find({ role: 'CSO', competency_type: 'Core' }).sort({ sequence: 1 }).toArray()
console.log(`\n=== Remaining CSO Core records (${remaining.length}) ===`)
remaining.forEach(d => console.log(`  seq=${d.sequence}  name="${d.name}"`))

// Show full remaining count
const total = await col.countDocuments()
console.log(`\nTotal competency records remaining: ${total}`)

await mongoose.disconnect()
