// ─── CPF Mirror — localStorage persistence layer ─────────────────────────────

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {} } catch { return {} }
}
function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

// ── Results (saved after each LLM analysis) ───────────────────────────────────
export function saveOfficerResults(officerId, results) {
  const all = load('cpf_results')
  all[officerId] = { ...results, savedAt: new Date().toISOString() }
  save('cpf_results', all)
}
export function loadOfficerResults(officerId) {
  return load('cpf_results')[officerId] || null
}
export function loadAllResults() {
  return load('cpf_results')
}

// ── Supervisor overrides (LLM score → supervisor-set score) ───────────────────
export function saveOverride(officerId, competencyName, { overrideLevel, justification, supervisorName }) {
  const all = load('cpf_overrides')
  if (!all[officerId]) all[officerId] = {}
  all[officerId][competencyName] = {
    overrideLevel,
    justification,
    supervisorName,
    timestamp: new Date().toISOString(),
  }
  save('cpf_overrides', all)
}
export function loadOverrides(officerId) {
  return load('cpf_overrides')[officerId] || {}
}
export function loadAllOverrides() {
  return load('cpf_overrides')
}

// ── Supervisor injections (blank competencies LLM cannot assess) ──────────────
export function saveInjection(officerId, competencyName, { level, justification, supervisorName }) {
  const all = load('cpf_injections')
  if (!all[officerId]) all[officerId] = {}
  all[officerId][competencyName] = {
    level,
    justification,
    supervisorName,
    timestamp: new Date().toISOString(),
  }
  save('cpf_injections', all)
}
export function loadInjections(officerId) {
  return load('cpf_injections')[officerId] || {}
}
export function loadAllInjections() {
  return load('cpf_injections')
}
