import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import User from '../server/models/User.js';
import CompetencyFramework from '../server/models/CompetencyFramework.js';

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://cpf-admin:CpfMirror2025!@cluster0.oyylvoa.mongodb.net/cpf?retryWrites=true&w=majority');

async function seedAdmin() {
  try {
    console.log('Seeding admin user and competencies...');

    // Create admin user
    const existingAdmin = await User.findOne({ username: 'admin' });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = new User({
        username: 'admin',
        password: hashedPassword,
        name: 'System Administrator',
        role: 'Admin'
      });
      await admin.save();
      console.log('Admin user created: username=admin, password=admin123');
    } else {
      console.log('Admin user already exists');
    }

    // Create sample competencies if they don't exist
    const sampleCompetencies = [
      {
        role: 'CSO',
        competency_type: 'Core',
        sequence: 1,
        name: 'Thinking Clearly & Sound Judgements',
        short_description: 'Ability to analyze situations and make logical decisions',
        bullet_points: [
          'Analyzes complex problems systematically',
          'Makes evidence-based decisions',
          'Considers multiple perspectives before acting'
        ],
        target_level: 'Advanced',
        measurable_from_correspondence: true,
        applicable_roles: ['CSO', 'TL', 'Supervisor'],
        assessment_method: 'correspondence_data'
      },
      {
        role: 'CSO',
        competency_type: 'Core',
        sequence: 2,
        name: 'Working as a Team',
        short_description: 'Collaboration and teamwork skills',
        bullet_points: [
          'Builds positive working relationships',
          'Contributes effectively to team goals',
          'Supports team members when needed'
        ],
        target_level: 'Advanced',
        measurable_from_correspondence: false,
        applicable_roles: ['CSO', 'TL', 'Supervisor'],
        assessment_method: 'manual_assessment'
      },
      {
        role: 'TL',
        competency_type: 'Leadership',
        sequence: 1,
        name: 'Team Leadership',
        short_description: 'Leading and managing team performance',
        bullet_points: [
          'Sets clear team objectives',
          'Provides regular feedback and coaching',
          'Manages team conflicts effectively'
        ],
        target_level: 'Advanced',
        measurable_from_correspondence: false,
        applicable_roles: ['TL', 'Supervisor'],
        assessment_method: 'manual_assessment'
      }
    ];

    for (const comp of sampleCompetencies) {
      const existing = await CompetencyFramework.findOne({ role: comp.role, name: comp.name });
      if (!existing) {
        const competency = new CompetencyFramework(comp);
        await competency.save();
        console.log(`Created competency: ${comp.name} for ${comp.role}`);
      }
    }

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Seeding error:', error);
  } finally {
    mongoose.connection.close();
  }
}

seedAdmin();
