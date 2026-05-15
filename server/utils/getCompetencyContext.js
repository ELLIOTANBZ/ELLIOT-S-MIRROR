import CompetencyFramework from '../models/CompetencyFramework.js';

/**
 * Build a formatted competency framework string for injection into AI prompts.
 * @param {string} officerRole  'CSO' | 'TL' | 'Supervisor'
 * @returns {string}  Formatted block, empty string if collection not seeded.
 */
export async function getCompetencyContext(officerRole) {
  const comps = await CompetencyFramework
    .find({ role: officerRole })
    .sort({ competency_type: 1, sequence: 1 })
    .lean();

  if (!comps.length) return '';

  const sections = ['Correspondence', 'Core', 'Functional', 'Leadership'];
  const lines = [];

  for (const type of sections) {
    const group = comps.filter(c => c.competency_type === type);
    if (!group.length) continue;

    lines.push(`${type.toUpperCase()} COMPETENCIES:`);
    group.forEach((c, i) => {
      const desc = c.short_description ? ` — ${c.short_description}` : '';
      lines.push(`${i + 1}. ${c.name}${desc}`);
      if (c.bullet_points?.length) {
        lines.push('Behavioural indicators:');
        c.bullet_points.forEach(b => lines.push(`- ${b}`));
      }
      lines.push('');
    });
  }

  return lines.join('\n').trim();
}

/**
 * Build the full system prompt for any OpenRouter AI call.
 * @param {string} officerRole
 * @returns {string}
 */
export async function buildCompetencySystemPrompt(officerRole) {
  const context = await getCompetencyContext(officerRole);

  if (!context) {
    return 'You are a CPF performance coach providing personalised, data-driven feedback.';
  }

  return `You are a CPF performance coach. Below are the official CPF competency definitions for a ${officerRole}. Use these definitions as your evaluation framework when analysing the officer's performance data.

${context}

Now here is the officer's performance data:`;
}
