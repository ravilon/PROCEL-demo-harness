import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { evaluateRoomRules } from './room-rules.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length;) {
  if (process.argv[i] === '--dry-run') { args.set('--dry-run', 'true'); i++; }
  else { args.set(process.argv[i], process.argv[i + 1]); i += 2; }
}
const dryRun = args.get('--dry-run') === 'true';
const count = Number(args.get('--count') ?? 1000);
const rate = Number(args.get('--rate') ?? 10);
const seed = Number(args.get('--seed') ?? 20261112);
const runId = args.get('--run-id') ?? `local-${seed}`;
const externalMean7dC = Number(args.get('--external-mean-c') ?? 17.5);
const externalTemperatureC = Number(args.get('--external-temperature-c') ?? externalMean7dC);
const courseId = args.get('--course-id') ?? null;
const missionId = args.get('--mission-id') ?? null;
const output = resolve(args.get('--output') ?? `runs/demo-${new Date().toISOString().replaceAll(':', '-')}`);
const roomsFile = args.get('--rooms-file');
const endpoint = process.env.PUBLISH_URL ?? 'http://localhost:3000/publish';
const producerId = process.env.PUBLISH_PRODUCER_ID ?? 'demo-presenter';
const apiKey = process.env.PUBLISH_API_KEY;
if (!dryRun && !apiKey) throw new Error('Defina PUBLISH_API_KEY no ambiente; a chave não é lida de arquivo nem gravada no relatório.');
if (!Number.isSafeInteger(count) || count < 1 || count > 1_000_000) throw new Error('--count deve estar entre 1 e 1000000.');
if (!Number.isFinite(rate) || rate <= 0 || rate > 500) throw new Error('--rate deve estar entre 0 e 500 eventos/s.');
if (!/^[A-Za-z0-9_-]{3,40}$/.test(runId)) throw new Error('--run-id deve conter entre 3 e 40 caracteres alfanumericos, _ ou -.');
if (!Number.isFinite(externalMean7dC) || !Number.isFinite(externalTemperatureC)) throw new Error('Informe temperaturas externas numericas em Celsius.');

// Every room must already have an active IDEAL_SENSOR and an MQTT integration
// binding. Never create room/sensor records implicitly during a performance run.
const rooms = roomsFile
  ? JSON.parse(await readFile(resolve(roomsFile), 'utf8'))
  : [{ roomId: process.env.DEMO_ROOM_ID ?? 'DEMO-ROOM-01', sensorId: process.env.DEMO_SENSOR_ID ?? 'IDEALSENSOR_347' }];
if (!Array.isArray(rooms) || rooms.length === 0 || rooms.some(room =>
  typeof room.roomId !== 'string' || !room.roomId || typeof room.sensorId !== 'string' || !room.sensorId)) {
  throw new Error('--rooms-file deve conter uma lista nao vazia de { roomId, sensorId }.');
}
if (new Set(rooms.map(room => room.roomId)).size !== rooms.length || new Set(rooms.map(room => room.sensorId)).size !== rooms.length) {
  throw new Error('Cada sala e cada sensor devem ser unicos no inventario da execucao.');
}
let state = seed >>> 0;
function random() { state = (1664525 * state + 1013904223) >>> 0; return state / 0x1_0000_0000; }
function quantile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0; }
function wilson(successes, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = successes / n, d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function sampleStdDev(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

await mkdir(output, { recursive: true });
const records = [];
const energyByRoom = new Map(rooms.map(room => [room.roomId, { ac: 0, lighting: 0, circuit: 0, total: 0 }]));
const runStart = performance.now();
const wallStart = new Date();
for (let i = 0; i < count; i++) {
  const targetTime = runStart + i * 1000 / rate;
  const wait = targetTime - performance.now();
  if (wait > 0) await new Promise(resolveTimer => setTimeout(resolveTimer, wait));
  const room = rooms[i % rooms.length];
  const phase = Math.floor(i / rooms.length) % 12;
  const scheduledUse = phase <= 7;
  const occupied = scheduledUse ? phase >= 2 && phase <= 7 : phase === 8 || phase === 9;
  const light = occupied ? random() > 0.08 : random() > 0.78;
  const temperature = Number((23.5 + Math.sin(phase / 12 * Math.PI * 2) * 2 + (random() - 0.5) * 0.6).toFixed(2));
  const teacherConfirmed = scheduledUse && phase !== 4;
  const qrCheckIn = phase === 4 || phase === 8;
  const roomExternalTemperatureC = externalTemperatureC;
  const acOn = phase % 4 !== 0;
  const intervalHours = rooms.length / rate / 3600;
  const acEnergyKwh = Number((acOn ? 1.5 * intervalHours : 0).toFixed(6));
  const lightingEnergyKwh = Number((light ? 0.12 * intervalHours : 0).toFixed(6));
  const otherEnergyKwh = Number((0.08 * intervalHours).toFixed(6));
  const energy = energyByRoom.get(room.roomId);
  energy.ac = Number((energy.ac + acEnergyKwh).toFixed(6));
  energy.lighting = Number((energy.lighting + lightingEnergyKwh).toFixed(6));
  energy.circuit = Number((energy.circuit + acEnergyKwh + lightingEnergyKwh).toFixed(6));
  energy.total = Number((energy.total + acEnergyKwh + lightingEnergyKwh + otherEnergyKwh).toFixed(6));
  const setpointC = [20, 21, 22, 24, 25, 26][phase % 6];
  const windowOpen = phase % 3 === 1;
  const noiseDb = Number((48 + random() * 25).toFixed(1));
  const co2Ppm = Math.round(450 + random() * 450);
  const roomReadings = {
    sequence: i,
    scheduled: scheduledUse,
    occupied,
    teacherConfirmed,
    qrCheckIn,
    externalMean7dC,
    externalTemperatureC: roomExternalTemperatureC,
    indoorTemperatureC: temperature,
    acEnergyKwh,
    setpointC,
    windowOpen,
    noiseDb,
    co2Ppm,
  };
  const ruleTrace = evaluateRoomRules(roomReadings);
  const messageId = `tcc-demo-${runId}-${String(i).padStart(8, '0')}`;
  const sourceTimestamp = new Date(wallStart.getTime() + i * 1000 / rate).toISOString();
  const humidityPct = Number((45 + random() * 25).toFixed(1));
  const payload = {
    messageId,
    timestamp: sourceTimestamp,
    light,
    presence: occupied,
    temperature,
    ac_status: acOn,
    energy_ac: acEnergyKwh,
    energy_lighting: lightingEnergyKwh,
    energy_room_circuit: Number((acEnergyKwh + lightingEnergyKwh).toFixed(6)),
    energy_total_room: Number((acEnergyKwh + lightingEnergyKwh + otherEnergyKwh).toFixed(6)),
    ac_setpoint_c: setpointC,
    humidity_pct: humidityPct,
    noise_db: noiseDb,
    co2_ppm: co2Ppm,
    window_open: windowOpen,
  };
  const started = performance.now();
  let status = 0, accepted = false, responseText = '';
  try {
    if (dryRun) throw Object.assign(new Error('dry-run: evento não publicado'), { dryRun: true });
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ producerId, sensorId: room.sensorId, messageId, sourceTimestamp, payload }),
      signal: AbortSignal.timeout(15000),
    });
    status = response.status;
    responseText = await response.text();
    accepted = status === 202;
  } catch (error) { responseText = String(error); }
  records.push({ sequence: i, roomId: room.roomId, sensorId: room.sensorId, messageId, sourceTimestamp,
    clientElapsedMs: dryRun ? null : Number((performance.now() - started).toFixed(3)), status: dryRun ? null : status, accepted,
    response: responseText.slice(0, 500), payload,
    simulatedClass: occupied ? { classId: `TCCDEMO-${runId}`, courseId, scheduled: scheduledUse, sequenceInRun: i, persistedClassSchedule: true } : null,
    simulatedInteraction: phase === 5 ? { type: 'MISSION_PROGRESS_BY_SENSOR_TRIGGER', missionId, recordedLocally: false } : null,
    simulatedTrigger: ruleTrace.occupancyAndAttribution.monitorSensorMetrics && ruleTrace.airConditioning.alerts.length
      ? { type: 'ROOM_RULE_ALERT', recordedLocally: true, backendRuleEvaluation: 'performed separately through environment-rule API' } : null,
    ruleTrace, roomRuleInputs: roomReadings });
}
const elapsedSeconds = (performance.now() - runStart) / 1000;
const latencies = records.filter(x => x.accepted).map(x => x.clientElapsedMs).sort((a, b) => a - b);
const success = records.filter(x => x.accepted).length;
const [successLow, successHigh] = wilson(success, count);
const latencyAverage = mean(latencies);
const latencyStdDev = sampleStdDev(latencies);
const roomRuleOutcomes = records.reduce((totals, row) => {
  const outcome = row.ruleTrace.occupancyAndAttribution.result;
  totals[outcome] = (totals[outcome] ?? 0) + 1;
  for (const alert of row.ruleTrace.airConditioning.alerts) totals[`alert:${alert}`] = (totals[`alert:${alert}`] ?? 0) + 1;
  return totals;
}, {});
const summary = {
  runId: randomUUID(), seed, startedAt: wallStart.toISOString(), finishedAt: new Date().toISOString(),
  endpoint: dryRun ? null : endpoint, dryRun, publisherAckOnly: true, count, targetRatePerSecond: rate, elapsedSeconds,
  producerId: dryRun ? null : producerId,
  attempted: dryRun ? 0 : count, brokerAcknowledged: success, failed: dryRun ? 0 : count - success,
  brokerAckRate: dryRun ? null : success / count, brokerAckRate95PercentWilsonCI: dryRun ? null : [successLow, successHigh],
  achievedRatePerSecond: dryRun ? null : count / elapsedSeconds,
  clientLatencyMs: {
    n: latencies.length,
    mean: latencyAverage,
    sampleStandardDeviation: latencyStdDev,
    standardError: latencies.length ? latencyStdDev / Math.sqrt(latencies.length) : 0,
    p50: quantile(latencies, .50),
    p90: quantile(latencies, .90),
    p95: quantile(latencies, .95),
    p99: quantile(latencies, .99),
  },
  interpretation: 'Client latency and HTTP 202 measure the publisher-to-MQTT-broker acknowledgement only. They do not establish Telemetry persistence or backend processing.',
  runId,
  simulatedClassesMissionsTriggersAreAnnotationsOnly: false,
  roomRulesEvaluatedLocally: true,
  roomRuleVersion: 'room-flowcharts-emulation-v1',
  measurementSpecificationVersion: 'tcc-demo-sensor-20261112-02-v1',
  measurementSpecification: {
    source: 'measurement-specs.json; all indoor/room readings synthetic, external temperature and seven-day average from WeatherAPI',
    energy: 'per-event kWh increments computed from assumed 1.5 kW AC, 0.12 kW lighting and 0.08 kW other loads over room sampling interval',
    parametersSent: Object.keys(records[0]?.payload ?? {}),
    sampling: { targetRateAcrossAllRoomsPerSecond: rate, timestamps: 'scheduled source time, evenly spaced across all rooms' },
    calibrationAccuracy: 'not applicable to virtual sensors; generated values are synthetic and make no physical accuracy claim',
  },
  externalMean7dC: { value: externalMean7dC, provenance: 'WeatherAPI external observations stored through the shared-context integration; seven-day weighted mean' },
  externalTemperatureC: { value: externalTemperatureC, provenance: 'WeatherAPI current observation stored through the shared-context integration' },
  ruleScoreAggregation: 'not calculated because diagram connectors do not unambiguously define cumulative points',
  roomRuleOutcomeAndAlertCounts: roomRuleOutcomes,
  roomSensorMapping: rooms,
  courseId,
  missionId,
};
const jsonl = records.map(row => JSON.stringify(row)).join('\n') + '\n';
await writeFile(resolve(output, 'events.ndjson'), jsonl, { flag: 'wx' });
await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
const manifest = {
  runId: summary.runId,
  createdAt: new Date().toISOString(),
  seed,
  runId,
  count,
  targetRatePerSecond: rate,
  roomCount: rooms.length,
  roomSensorMapping: rooms,
  courseId,
  missionId,
  measurementSpecificationVersion: summary.measurementSpecificationVersion,
  hashAlgorithm: 'SHA-256',
  hashSha256: createHash('sha256').update(jsonl).digest('hex'),
};
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ...summary }, null, 2));
