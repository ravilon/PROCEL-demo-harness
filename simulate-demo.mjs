import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
const output = resolve(args.get('--output') ?? `runs/demo-${new Date().toISOString().replaceAll(':', '-')}`);
const endpoint = process.env.PUBLISH_URL ?? 'http://localhost:3000/publish';
const producerId = process.env.PUBLISH_PRODUCER_ID ?? 'demo-presenter';
const apiKey = process.env.PUBLISH_API_KEY;
if (!dryRun && !apiKey) throw new Error('Defina PUBLISH_API_KEY no ambiente; a chave não é lida de arquivo nem gravada no relatório.');
if (!Number.isSafeInteger(count) || count < 1 || count > 1_000_000) throw new Error('--count deve estar entre 1 e 1000000.');
if (!Number.isFinite(rate) || rate <= 0 || rate > 500) throw new Error('--rate deve estar entre 0 e 500 eventos/s.');

// Existing isolated DEMO room/sensor in the test deployment. Keep the payload
// compatible with its IDEAL_SENSOR profile; rule-only values stay in the trace.
const rooms = [
  { roomId: process.env.DEMO_ROOM_ID ?? 'DEMO-ROOM-01', sensorId: process.env.DEMO_SENSOR_ID ?? 'IDEALSENSOR_347' },
];
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

await mkdir(output, { recursive: true });
const records = [];
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
  const externalTemperatureC = Number((18 + Math.sin(phase / 12 * Math.PI * 2) * 5 + (random() - 0.5)).toFixed(2));
  const roomReadings = {
    sequence: i,
    scheduled: scheduledUse,
    occupied,
    teacherConfirmed,
    qrCheckIn,
    externalMean7dC: 17.5, // synthetic fixed baseline; not the live WeatherAPI reading
    externalTemperatureC,
    indoorTemperatureC: temperature,
    acEnergyKwh: phase % 4 === 0 ? 0 : Number((0.12 + random() * 0.25).toFixed(3)),
    setpointC: [20, 21, 22, 24, 25, 26][phase % 6],
    windowOpen: phase % 3 === 1,
    noiseDb: Number((48 + random() * 25).toFixed(1)),
    co2Ppm: Math.round(450 + random() * 450),
  };
  const ruleTrace = evaluateRoomRules(roomReadings);
  const messageId = `demo-tcc-${seed}-${String(i).padStart(8, '0')}`;
  const sourceTimestamp = new Date(wallStart.getTime() + i * 1000 / rate).toISOString();
  const payload = { messageId, timestamp: sourceTimestamp, light, presence: occupied, temperature };
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
    simulatedClass: occupied ? { classId: 'DEMO_TCC_AULA_SIMULADA', scheduled: scheduledUse, sequenceInRun: i } : null,
    simulatedInteraction: phase === 5 ? { type: 'ALUNO_CONCLUIU_MISSAO_DEMO', recordedLocally: true } : null,
    simulatedTrigger: ruleTrace.occupancyAndAttribution.monitorSensorMetrics && ruleTrace.airConditioning.alerts.length
      ? { type: 'EVENTO_AMBIENTE_DEMO', recordedLocally: true } : null,
    ruleTrace, roomRuleInputs: roomReadings });
}
const elapsedSeconds = (performance.now() - runStart) / 1000;
const latencies = records.filter(x => x.accepted).map(x => x.clientElapsedMs).sort((a, b) => a - b);
const success = records.filter(x => x.accepted).length;
const [successLow, successHigh] = wilson(success, count);
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
  clientLatencyMs: { n: latencies.length, mean: mean(latencies), p50: quantile(latencies, .50), p95: quantile(latencies, .95), p99: quantile(latencies, .99) },
  interpretation: 'Client latency and HTTP 202 measure the publisher-to-MQTT-broker acknowledgement only. They do not establish Telemetry persistence or backend processing.',
  simulatedClassesMissionsTriggersAreAnnotationsOnly: true,
  roomRulesEvaluatedLocally: true,
  roomRuleVersion: 'room-flowcharts-emulation-v1',
  externalMean7dC: { value: 17.5, provenance: 'synthetic fixed value; not WeatherAPI and not observed historical data' },
  ruleScoreAggregation: 'not calculated because diagram connectors do not unambiguously define cumulative points',
  roomRuleOutcomeAndAlertCounts: roomRuleOutcomes,
  roomSensorMapping: rooms,
};
const jsonl = records.map(row => JSON.stringify(row)).join('\n') + '\n';
await writeFile(resolve(output, 'events.ndjson'), jsonl, { flag: 'wx' });
await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
const manifest = { runId: summary.runId, seed, count, rate, hashSha256: createHash('sha256').update(jsonl).digest('hex') };
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ...summary }, null, 2));
