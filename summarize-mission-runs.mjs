import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = 'runs';
const runIds = [
  '20261112-03-r1-mission',
  '20261112-03-r2-mission',
  '20261112-03-r3-mission',
];
const tCritical95Df2 = 4.302652729911275;
const parseJson = (text) => JSON.parse(text.replace(/^\uFEFF/, ''));

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function meanInterval(values) {
  const average = mean(values);
  const sd = sampleSd(values);
  const margin = tCritical95Df2 * sd / Math.sqrt(values.length);
  return { mean: average, sampleStandardDeviation: sd, confidence95T: [average - margin, average + margin] };
}

function wilson(successes, trials) {
  const z = 1.96;
  const p = successes / trials;
  const divisor = 1 + z * z / trials;
  const center = (p + z * z / (2 * trials)) / divisor;
  const margin = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / divisor;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)] ?? 0;
}

const repetitions = [];
for (const runId of runIds) {
  const directory = `${root}/tcc-${runId}`;
  const [summary, manifest, server, mission, eventsText] = await Promise.all([
    readFile(`${directory}/summary.json`, 'utf8').then(parseJson),
    readFile(`${directory}/manifest.json`, 'utf8').then(parseJson),
    readFile(`${directory}/server-metrics.json`, 'utf8').then(parseJson),
    readFile(`${directory}/mission-server-metrics.json`, 'utf8').then(parseJson),
    readFile(`${directory}/events.ndjson`, 'utf8'),
  ]);
  const hash = createHash('sha256').update(eventsText).digest('hex');
  if (hash !== manifest.hashSha256) throw new Error(`Hash divergence in ${runId}`);
  const eventCount = mission.matchedOccurrences;
  const completed = mission.activityStatuses.find((status) => status.status === 'CONCLUIDA')?.count ?? 0;
  const delays = mission.sourceToDetectedLatencyMilliseconds;
  repetitions.push({
    runId,
    seed: summary.seed,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    eventCount,
    processedEvents: mission.processedOccurrences,
    eventRate: eventCount / summary.count,
    missionDetectionDelayMeanMilliseconds: mean(delays),
    missionDetectionDelayP95Milliseconds: quantile(delays, 0.95),
    activitiesAssigned: mission.activitiesAssigned,
    activitiesCompleted: completed,
    brokerAcknowledged: summary.brokerAcknowledged,
    attempted: summary.attempted,
    achievedEventsPerSecond: summary.achievedRatePerSecond,
    brokerAckMeanMilliseconds: summary.clientLatencyMs.mean,
    brokerAckP95Milliseconds: summary.clientLatencyMs.p95,
    brokerAckP99Milliseconds: summary.clientLatencyMs.p99,
    canonicalMeasurements: server.canonicalMeasurementsReturned,
    parameterValues: server.expectedParameterValues,
    qualifications: server.observedQualifications,
    qualificationStatuses: server.resultsByStatus,
    qualificationReconciled: server.reconciliationComplete,
    roomRuleOutcomes: summary.roomRuleOutcomeAndAlertCounts,
    eventsSha256: hash,
    missionId: mission.missionId,
    eventId: mission.eventId,
  });
}

const totalAttempted = repetitions.reduce((sum, run) => sum + run.attempted, 0);
const totalAck = repetitions.reduce((sum, run) => sum + run.brokerAcknowledged, 0);
const totalOccurrences = repetitions.reduce((sum, run) => sum + run.eventCount, 0);
const totalProcessedEvents = repetitions.reduce((sum, run) => sum + run.processedEvents, 0);
const totalAssigned = repetitions.reduce((sum, run) => sum + run.activitiesAssigned, 0);
const totalCompleted = repetitions.reduce((sum, run) => sum + run.activitiesCompleted, 0);
const totalCanonical = repetitions.reduce((sum, run) => sum + run.canonicalMeasurements, 0);
const totalParameterValues = repetitions.reduce((sum, run) => sum + run.parameterValues, 0);
const totalQualifications = repetitions.reduce((sum, run) => sum + run.qualifications, 0);
const statusTotals = repetitions.reduce((totals, run) => {
  for (const [status, count] of Object.entries(run.qualificationStatuses)) {
    totals[status] = (totals[status] ?? 0) + count;
  }
  return totals;
}, {});
const rateStats = meanInterval(repetitions.map((run) => run.achievedEventsPerSecond));
const occurrenceStats = meanInterval(repetitions.map((run) => run.eventCount));
const eventRateStats = meanInterval(repetitions.map((run) => run.eventRate));
const ackMeanStats = meanInterval(repetitions.map((run) => run.brokerAckMeanMilliseconds));
const ackP95Stats = meanInterval(repetitions.map((run) => run.brokerAckP95Milliseconds));
const missionDetectionDelayStats = meanInterval(repetitions.map((run) => run.missionDetectionDelayMeanMilliseconds));
const backgroundEvent = parseJson(await readFile(`${root}/tcc-20261112-03-background-event-observation.json`, 'utf8'));
const backgroundOccurrences = backgroundEvent.events.reduce((sum, event) => sum + event.sourceWindowOccurrences, 0);
const backgroundProcessed = backgroundEvent.events.reduce((sum, event) => sum + event.statuses
  .filter((status) => status.status === 'PROCESSADO')
  .reduce((count, status) => count + status.count, 0), 0);
const setupPilotActivities = backgroundEvent.setupPilotMissionActivities;
const setupPilotActivitiesCompleted = setupPilotActivities.activityStatuses
  .filter((status) => status.status === 'CONCLUIDA')
  .reduce((count, status) => count + status.count, 0);
const payload = {
  experimentId: 'TCC-MISSION-END-TO-END-20261112-03',
  generatedAt: new Date().toISOString(),
  repetitions: 3,
  workload: {
    messagesPerRepetition: 150,
    targetMessagesPerSecond: 2,
    virtualRoomsAndSensors: 10,
    numericAndStateParametersPerMessage: 13,
    injectedQualificationAnomalyRate: 0.1,
    missionCondition: 'temperature >= 25 C',
    eligibleStudentsPerRepetition: 20,
    lessonContext: 'active scheduled room lessons and active course/discipline enrollments',
    externalWeatherContextC: { sevenDayMean: 18.23, currentObservation: 25.6 },
  },
  totals: {
    attempted: totalAttempted,
    brokerAcknowledged: totalAck,
    brokerAckRate: totalAck / totalAttempted,
    brokerAckRateWilson95: wilson(totalAck, totalAttempted),
    canonicalMeasurements: totalCanonical,
    parameterValues: totalParameterValues,
    ruleEvaluations: totalQualifications,
    qualificationStatuses: statusTotals,
    missionEventOccurrences: totalOccurrences,
    processedMissionEventOccurrences: totalProcessedEvents,
    otherActiveMissionEventOccurrencesDuringSourceWindow: backgroundOccurrences,
    otherActiveMissionEventOccurrencesProcessed: backgroundProcessed,
    allMissionEventOccurrencesDuringSourceWindow: totalOccurrences + backgroundOccurrences,
    allMissionEventOccurrencesProcessed: totalProcessedEvents + backgroundProcessed,
    setupPilotActivitiesAssigned: setupPilotActivities.activitiesAssigned,
    setupPilotActivitiesCompleted,
    activitiesAssigned: totalAssigned,
    activitiesCompleted: totalCompleted,
    activityCompletionRate: totalCompleted / totalAssigned,
    activityCompletionWilson95: wilson(totalCompleted, totalAssigned),
    allCanonicalAndQualificationReconciliationsComplete: repetitions.every((run) => run.qualificationReconciled),
  },
  acrossRepetitions: {
    achievedMessagesPerSecond: rateStats,
    missionOccurrencesPerRepetition: occurrenceStats,
    missionOccurrenceRatePerMessage: eventRateStats,
    brokerAckMeanMilliseconds: ackMeanStats,
    brokerAckP95MillisecondsByRepetition: ackP95Stats,
    missionWorkerSourceToDetectedDelayMilliseconds: missionDetectionDelayStats,
    note: 't intervals use n=3 independent repetitions (df=2). Percentile summaries are descriptive across repetitions; ACK latency is publisher-to-broker only.',
  },
  repetitions,
  concurrentPreExistingMissionEvent: backgroundEvent,
  aggregation: parseJson(await readFile(`${root}/tcc-20261112-03-analytics-job.json`, 'utf8')),
  analyticsQuery: {
    sensorTypeName: 'TCC_DEMO_SENSOR_20261112-02',
    parameter: 'temperature',
    bucketWindow: 'PT1M',
    expectedTemperatureBuckets: 60,
    sensors: 10,
    oneMinuteWindows: 6,
  },
  provenanceAndLimitations: [
    'Indoor and room sensor values are synthetic; no physical sensor accuracy or calibration is claimed.',
    'WeatherAPI observations are external real observations and are kept distinct from virtual indoor measurements.',
    'HTTP 202 and client ACK latency measure the publisher-to-MQTT-broker acknowledgement only.',
    'Canonical measurement and rule-evaluation totals were reconciled through authenticated backend APIs.',
    'Mission occurrences and activity status were queried from the staging API after asynchronous workers processed them.',
    'Room flowchart predicates are locally emulated by the harness; mission events and student activities are processed and persisted by the backend.',
    'Only one of the three run-specific mission events was enabled at a time, and all three were disabled after collection.',
    'The pre-existing TCC-02 event and an initial setup event generated separate occurrences during the source-time window; both sets are counted separately and were part of the staging workload. The setup event also completed its own 20 activities and was disabled after collection; the pre-existing event was left in its original active state.',
  ],
};

await writeFile(`${root}/tcc-20261112-03-mission-results.json`, `${JSON.stringify(payload, null, 2)}\n`);

const pct = (value) => `${(value * 100).toFixed(2)}%`;
const ms = (value) => `${value.toFixed(3)} ms`;
const md = [
  '# TCC Demo — missões, gatilhos e carga',
  '',
  '## Protocolo',
  '',
  'Três repetições independentes, cada uma com 150 mensagens a 2 mensagens/s distribuídas por dez sensores virtuais em dez salas. Cada repetição teve uma missão nova, 20 atividades previamente atribuídas e um único gatilho ativo: medição recebida com temperatura interna maior ou igual a 25 °C. O contexto real de processamento usou o período de aula ativo e os 20 vínculos acadêmicos ativos do curso/disciplina demo.',
  '',
  '## Resultados conciliados',
  '',
  `- ACK publisher/broker: ${totalAck}/${totalAttempted} (${pct(totalAck / totalAttempted)}; IC95% Wilson ${pct(wilson(totalAck, totalAttempted)[0])}–${pct(wilson(totalAck, totalAttempted)[1])}).`,
  `- Medições canônicas: ${totalCanonical}/${totalAttempted}; valores e avaliações de regras: ${totalParameterValues}/${totalQualifications}. Todas as três conciliações foram completas.`,
  `- Qualificações persistidas: ${statusTotals.NORMAL ?? 0} NORMAL e ${statusTotals.ALERTA ?? 0} ALERTA; ALERTA corresponde às anomalias sintéticas intencionais.`,
  `- Ocorrências de missão: ${totalOccurrences}; processadas: ${totalProcessedEvents}. Média por repetição ${occurrenceStats.mean.toFixed(2)}, DP amostral ${occurrenceStats.sampleStandardDeviation.toFixed(2)}, IC95% t ${occurrenceStats.confidence95T[0].toFixed(2)}–${occurrenceStats.confidence95T[1].toFixed(2)}.`,
  `- Atraso medição→worker (inicioEm→detectadoEm): média por repetição ${missionDetectionDelayStats.mean.toFixed(2)} ms, DP amostral ${missionDetectionDelayStats.sampleStandardDeviation.toFixed(2)} ms, IC95% t ${missionDetectionDelayStats.confidence95T[0].toFixed(2)}–${missionDetectionDelayStats.confidence95T[1].toFixed(2)} ms.`,
  `- Eventos fora das três missões de medição: ${backgroundOccurrences} ocorrências adicionais, ${backgroundProcessed} processadas. A missão criada na preparação concluiu ${setupPilotActivitiesCompleted}/${setupPilotActivities.activitiesAssigned} atividades próprias. Esses resultados foram separados dos contadores do gatilho novo, mas compõem a carga real observada no staging.`,
  `- Atividades: ${totalCompleted}/${totalAssigned} concluídas (${pct(totalCompleted / totalAssigned)}; IC95% Wilson ${pct(wilson(totalCompleted, totalAssigned)[0])}–${pct(wilson(totalCompleted, totalAssigned)[1])}).`,
  `- Buckets de temperatura: ${payload.analyticsQuery.expectedTemperatureBuckets} pontos, dez sensores e seis janelas de um minuto; job ${payload.aggregation.id} terminou ${payload.aggregation.status}.`,
  '',
  '## Estatísticas entre repetições (n=3)',
  '',
  '| Medida | Média | DP amostral | IC95% t (df=2) |',
  '|---|---:|---:|---:|',
  `| Taxa alcançada | ${rateStats.mean.toFixed(4)} msg/s | ${rateStats.sampleStandardDeviation.toFixed(4)} | ${rateStats.confidence95T[0].toFixed(4)}–${rateStats.confidence95T[1].toFixed(4)} |`,
  `| Ocorrências de missão | ${occurrenceStats.mean.toFixed(2)} | ${occurrenceStats.sampleStandardDeviation.toFixed(2)} | ${occurrenceStats.confidence95T[0].toFixed(2)}–${occurrenceStats.confidence95T[1].toFixed(2)} |`,
  `| Taxa de ocorrência/mensagem | ${pct(eventRateStats.mean)} | ${pct(eventRateStats.sampleStandardDeviation)} | ${pct(eventRateStats.confidence95T[0])}–${pct(eventRateStats.confidence95T[1])} |`,
  `| ACK médio publisher/broker | ${ms(ackMeanStats.mean)} | ${ms(ackMeanStats.sampleStandardDeviation)} | ${ms(ackMeanStats.confidence95T[0])}–${ms(ackMeanStats.confidence95T[1])} |`,
  `| ACK p95 por repetição | ${ms(ackP95Stats.mean)} | ${ms(ackP95Stats.sampleStandardDeviation)} | ${ms(ackP95Stats.confidence95T[0])}–${ms(ackP95Stats.confidence95T[1])} |`,
  `| Atraso medição→worker | ${ms(missionDetectionDelayStats.mean)} | ${ms(missionDetectionDelayStats.sampleStandardDeviation)} | ${ms(missionDetectionDelayStats.confidence95T[0])}–${ms(missionDetectionDelayStats.confidence95T[1])} |`,
  '',
  '| Repetição | ACK | Ocorrências processadas | Atividades concluídas | Taxa msg/s | ACK médio / p95 / p99 | Worker médio / p95 |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...repetitions.map((run) => `| ${run.runId} | ${run.brokerAcknowledged}/${run.attempted} | ${run.processedEvents}/${run.eventCount} | ${run.activitiesCompleted}/${run.activitiesAssigned} | ${run.achievedEventsPerSecond.toFixed(4)} | ${run.brokerAckMeanMilliseconds.toFixed(2)} / ${run.brokerAckP95Milliseconds.toFixed(2)} / ${run.brokerAckP99Milliseconds.toFixed(2)} ms | ${run.missionDetectionDelayMeanMilliseconds.toFixed(2)} / ${run.missionDetectionDelayP95Milliseconds.toFixed(2)} ms |`),
  '',
  '## Limites de interpretação',
  '',
  'A latência ACK mede apenas publisher→broker. O atraso do worker é medido entre o timestamp da medição (inicioEm) e a detecção processada (detectadoEm), e não deve ser confundido com tempo de resposta HTTP. Persistência canônica e avaliações foram confirmadas separadamente por API; ocorrência de gatilho e conclusão de atividade foram confirmadas depois do worker assíncrono. Dois outros eventos de temperatura geraram 200 ocorrências na janela e foram contabilizados à parte; a missão de preparação concluiu 20 atividades próprias. O evento de preparação foi desativado após a carga; o evento TCC-02 preexistente permaneceu ativo. Leituras internas e regras ambientais são sintéticas; não representam precisão de sensor físico. O fluxo local dos diagramas de salas e os eventos/missões persistidos são métricas distintas.',
  '',
  '## Artefatos',
  '',
  '- `tcc-20261112-03-mission-results.json`: consolidação estatística e IDs do job.',
  '- `tcc-20261112-03-mission-plan.json`: IDs de curso, alunos, missões e gatilhos.',
  '- `tcc-20261112-03-academic-context.json`: períodos de aula e vínculos acadêmicos verificados.',
  '- `tcc-20261112-03-background-event-observation.json`: evento legado e ocorrências concorrentes fora das métricas das novas missões.',
  ...runIds.map((runId) => '- `' + runId + '/`: eventos NDJSON, manifesto/hash, resumo, conciliação de medições/avaliações e métricas de ocorrências/atividades.'),
  '- `tcc-20261112-03-analytics-job.json`: progresso e resultado do job de agregação.',
  '',
].join('\n');
await writeFile(`${root}/tcc-20261112-03-mission-results.md`, `${md}\n`);
console.log(`Saved report: ${root}/tcc-20261112-03-mission-results.md`);
