import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiBaseUrl = (process.env.PROBEN_API_BASE_URL ?? 'https://procel.servehttp.com').replace(/\/+$/, '');
const email = process.env.PROBEN_ADMIN_EMAIL;
const password = process.env.PROBEN_ADMIN_PASSWORD;
const runId = process.env.TCC_DEMO_RUN_ID;
const runTag = process.env.TCC_DEMO_RUN_TAG ?? '20261112-02';
if (!email || !password || !runId || !/^[A-Za-z0-9_-]{3,40}$/.test(runId)) {
  throw new Error('Defina PROBEN_ADMIN_EMAIL, PROBEN_ADMIN_PASSWORD e TCC_DEMO_RUN_ID no ambiente do processo.');
}

async function request(path, token) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(`GET ${path} retornou ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

const login = await fetch(`${apiBaseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then(async response => {
  const payload = await response.json();
  if (!response.ok) throw new Error(`Login retornou ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
});
const token = login.accessToken;

const runDir = resolve(`runs/tcc-${runId}`);
const summary = JSON.parse(await readFile(resolve(runDir, 'summary.json'), 'utf8'));
const qualification = JSON.parse(await readFile(resolve(`runs/tcc-${runTag}-sensor-qualifications.json`), 'utf8'));
const rooms = JSON.parse(await readFile(resolve(`rooms-${runTag}.json`), 'utf8'));
const ruleIds = new Set(qualification.createdRules.map(rule => rule.id));
const from = summary.startedAt;
const to = new Date(Date.parse(summary.finishedAt) + 5 * 60_000).toISOString();

let result = [];
let attempts = 0;
do {
  attempts++;
  result = await Promise.all(rooms.map(async ({ sensorId }) => {
    const params = new URLSearchParams({ from, to, page: '0', limit: '1000' });
    return request(`/api/sensors/${encodeURIComponent(sensorId)}/medicoes?${params}`, token);
  }));
  const count = result.reduce((sum, measurements) => sum + measurements.length, 0);
  if (count >= summary.count || attempts >= 12) break;
  await new Promise(resolveTimer => setTimeout(resolveTimer, 10_000));
} while (true);

const measurements = result.flat();
const resultsByStatus = {};
const evaluationsByParameter = {};
let groupEvaluationCount = 0;
for (const measurement of measurements) {
  for (const [parameter, evaluations] of Object.entries(measurement.qualificacoes ?? {})) {
    for (const evaluation of evaluations) {
      if (!ruleIds.has(evaluation.regraParametroId)) continue;
      groupEvaluationCount++;
      resultsByStatus[evaluation.resultado] = (resultsByStatus[evaluation.resultado] ?? 0) + 1;
      evaluationsByParameter[parameter] ??= {};
      evaluationsByParameter[parameter][evaluation.resultado] = (evaluationsByParameter[parameter][evaluation.resultado] ?? 0) + 1;
    }
  }
}

const report = {
  runId,
  collectedAt: new Date().toISOString(),
  source: 'authenticated per-sensor measurement API; only evaluations whose rule IDs belong to the run qualification group are counted',
  start: from,
  end: to,
  expectedCanonicalMeasurements: summary.count,
  canonicalMeasurementsReturned: measurements.length,
  expectedParameterValues: summary.count * qualification.parameterCount,
  qualificationGroupId: qualification.group.id,
  expectedQualifications: summary.count * qualification.parameterCount,
  observedQualifications: groupEvaluationCount,
  resultsByStatus,
  evaluationsByParameter,
  expectedSyntheticAnomaliesByParameter: summary.sensorRuleQualification?.injectedOutOfRangeSamplesByParameter ?? {},
  expectedAlertEvaluations: summary.sensorRuleQualification?.expectedAlertEvaluations ?? null,
  reconciliationComplete: measurements.length === summary.count && groupEvaluationCount === summary.count * qualification.parameterCount,
  collectionAttempts: attempts,
};
await writeFile(resolve(runDir, 'server-metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
