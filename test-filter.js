import User from './server/models/User.js';

// Test the admin exclusion logic
const testFilters = [
  { role: 'TL', expected: { role: 'CSO' } },
  { role: 'Supervisor', expected: { role: { $in: ['CSO', 'TL'] } } },
  { role: 'Admin', expected: {} },
];

testFilters.forEach(({ role, expected }) => {
  let filter = {};
  if (role === 'CSO') filter = {};
  if (role === 'TL') filter = { role: 'CSO' };
  if (role === 'Supervisor') filter = { role: { $in: ['CSO', 'TL'] } };
  if (role === 'Admin') filter = { role: { $ne: 'Admin' } };
  
  const matches = JSON.stringify(filter) === JSON.stringify(expected);
  console.log('Role: ' + role + ', Filter: ' + JSON.stringify(filter) + ', Expected: ' + JSON.stringify(expected) + ', Matches: ' + matches);
});
