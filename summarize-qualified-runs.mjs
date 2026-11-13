import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const runIds = [
  '20261112-02-qualified-anomaly-r1',
  '20261112-02-qualified-anomaly-r2',
  '20261112-02-qualified-anomaly-r3',
];
const tCritical95Df2 = 4.3026527299;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function sampleStats(values) {
  const avg = mean(values);
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
  const se = sd / Math.sqrt(values.length);
  return {
    n: values.length,
    mean: avg,
    sampleStandardDeviation: sd,
    standardError: se,
    confidence95StudentT: [avg - tCritical95Df2 * se, avg + tCritical95Df2 * se],
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}
function descriptiveStats(values) {
  return {
    n: values.length,
    mean: mean(values),
    sampleStandardDeviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean(values)) ** 2, 0) / (values.length - 1)),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}
function wilson(successes, n) {
  const z = 1.96;
  const p = successes / n;
  const d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

const rows = await Promise.all(runIds.map(async runId => {
  const folder = resolve(`runs/tcc-${runId}`);
  const [summary, serverMetrics] = await Promise.all([
    readFile(resolve(folder, 'summary.json'), 'utf8').then(JSON.parse),
    readFile(resolve(folder, 'server-metrics.json'), 'utf8').then(JSON.parse),
  ]);
  if (!serverMetrics.reconciliationComplete) throw new Error(`Reconciliation incomplete for ${runId}`);
  if (summary.brokerAcknowledged !== summary.count) throw new Error(`Publisher ACK failures in ${runId}`);
  return { runId, summary, serverMetrics };
}));

const accepted = rows.reduce((sum, row) => sum + row.summary.brokerAcknowledged, 0);
const attempted = rows.reduce((sum, row) => sum + row.summary.attempted, 0);
const canonicalMeasurements = rows.reduce((sum, row) => sum + row.serverMetrics.canonicalMeasurementsReturned, 0);
const qualifications = rows.reduce((sum, row) => sum + row.serverMetrics.observedQualifications, 0);
const resultCounts = rows.reduce((totals, row) => {
  for (const [status, count] of Object.entries(row.serverMetrics.resultsByStatus)) {
    totals[status] = (totals[status] ?? 0) + count;
  }
  return totals;
}, {});
const alertByParameter = rows.reduce((totals, row) => {
  for (const [parameter, values] of Object.entries(row.serverMetrics.evaluationsByParameter)) {
    if (values.ALERTA) totals[parameter] = (totals[parameter] ?? 0) + values.ALERTA;
  }
  return totals;
}, {});

const report = {
  runIds,
  generatedAt: new Date().toISOString(),
  workload: {
    roomCount: 10,
    sensorCount: 10,
    eventsPerRun: 300,
    targetRatePerSecond: 2,
    anomalyRate: 0.1,
    sensorRuleGroupId: rows[0].serverMetrics.qualificationGroupId,
    parameterDefinitions: 13,
    activeRules: 26,
    expectedQualificationsPerMeasurement: 13,
    anomalies: 'temperature 31 C; humidity 91%; noise 86 dB; CO2 2001 ppm; one injected anomaly per ten events, rotated deterministically',
  },
  totals: {
    publisherAcknowledged: accepted,
    attempted: attempted,
    brokerAckRate: accepted / attempted,
    brokerAckRate95PercentWilsonCI: wilson(accepted, attempted),
    canonicalMeasurements,
    parameterValues: canonicalMeasurements * 13,
    qualificationEvaluations: qualifications,
    qualificationResultsByStatus: resultCounts,
    alertEvaluationsByParameter: alertByParameter,
    reconciliationComplete: rows.every(row => row.serverMetrics.reconciliationComplete),
  },
  acrossRunStatistics: {
    achievedEventsPerSecond: sampleStats(rows.map(row => row.summary.achievedRatePerSecond)),
    clientAckMeanMilliseconds: sampleStats(rows.map(row => row.summary.clientLatencyMs.mean)),
    clientAckP95Milliseconds: descriptiveStats(rows.map(row => row.summary.clientLatencyMs.p95)),
    clientAckP99Milliseconds: descriptiveStats(rows.map(row => row.summary.clientLatencyMs.p99)),
  },
  runs: rows.map(({ runId, summary, serverMetrics }) => ({
    runId,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    achievedEventsPerSecond: summary.achievedRatePerSecond,
    brokerAckRate: summary.brokerAckRate,
    clientAckMeanMs: summary.clientLatencyMs.mean,
    clientAckP95Ms: summary.clientLatencyMs.p95,
    clientAckP99Ms: summary.clientLatencyMs.p99,
    canonicalMeasurements: serverMetrics.canonicalMeasurementsReturned,
    qualificationEvaluations: serverMetrics.observedQualifications,
    resultsByStatus: serverMetrics.resultsByStatus,
  })),
  interpretation: 'Publisher ACK latency is not backend processing latency. All canonical measurement and rule qualification counts were reconciled through the authenticated API. The 95% Student-t intervals summarize three independent runs and remain preliminary; the stimuli are virtual and intentionally include out-of-range values.',
};

const jsonPath = resolve('runs/tcc-20261112-02-qualified-anomaly-results.json');
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const markdown = [
  '# TCC Demo — carga com qualificacao de sensores',
  '',
  '## Desenho',
  '',
  'Tres execucoes independentes de 300 mensagens, taxa alvo total de 2 mensagens/s, dez salas/sensores virtuais, 13 parametros por mensagem, 26 regras ativas no grupo vinculado aos sensores. A taxa de anomalias foi 10%, distribuida de forma deterministica entre temperatura, umidade, ruido e CO2.',
  '',
  '## Resultados conciliados',
  '',
  `- ACK do publisher: ${accepted}/${attempted} (${(accepted / attempted * 100).toFixed(2)}%; IC95% Wilson ${(report.totals.brokerAckRate95PercentWilsonCI[0] * 100).toFixed(2)}%–${(report.totals.brokerAckRate95PercentWilsonCI[1] * 100).toFixed(2)}%).`,
  `- Medicoes canonicas: ${canonicalMeasurements}; valores parametrizados: ${canonicalMeasurements * 13}.`,
  `- Avaliacoes persistidas do grupo: ${qualifications}; NORMAL=${resultCounts.NORMAL ?? 0}, ALERTA=${resultCounts.ALERTA ?? 0}.`,
  `- Alertas por parametro: ${Object.entries(alertByParameter).map(([key, value]) => `${key}=${value}`).join(', ')}.`,
  `- Conciliacao integral das tres rodadas: ${report.totals.reconciliationComplete ? 'sim' : 'nao'}.`,
  '',
  '## Estatisticas entre rodadas (n=3)',
  '',
  '| Medida | Media | DP amostral | IC95% t (df=2) |',
  '|---|---:|---:|---:|',
  ...Object.entries(report.acrossRunStatistics).map(([name, value]) => `| ${name} | ${value.mean.toFixed(4)} | ${value.sampleStandardDeviation.toFixed(4)} | ${value.confidence95StudentT ? `${value.confidence95StudentT[0].toFixed(4)} a ${value.confidence95StudentT[1].toFixed(4)}` : 'n/a para percentis com n=3'} |`),
  '',
  'A latencia cliente mede apenas o ACK publisher/broker. As APIs autenticadas confirmam persistencia canonica e qualificacoes, mas nao fornecem neste relatorio a latencia interna Telemetry→API. `ALERTA` representa qualificacao de valor sintetico fora da faixa e nao rejeicao de ingestao. Valores virtuais nao reivindicam precisao ou calibracao fisica.',
  '',
  `Detalhes JSON: ${jsonPath.replaceAll('\\', '/')}`,
  '',
].join('\n');
await writeFile(resolve('runs/tcc-20261112-02-qualified-anomaly-results.md'), markdown);
console.log(JSON.stringify({ jsonPath, totals: report.totals, acrossRunStatistics: report.acrossRunStatistics }, null, 2));
