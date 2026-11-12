/**
 * Deterministic, local emulation of the supplied room decision diagrams.
 * These rules create experiment traces only; they do not invoke backend rules.
 */
export function evaluateRoomRules(input) {
  const scheduled = input.scheduled;
  const occupied = input.occupied;
  const teacherConfirmed = input.teacherConfirmed;
  const qrCheckIn = input.qrCheckIn;
  const monitor = scheduled
    ? teacherConfirmed || qrCheckIn
    : occupied && qrCheckIn;
  const attribution = monitor ? 'MONITORAR_COM_PONTOS' : 'SEM_ATRIBUICAO_DE_PONTOS';
  const sessionActive = scheduled || occupied;

  const neutralTemperature = 17.8 + 0.31 * input.externalMean7dC;
  const comfortLowerC = neutralTemperature - 3.5;
  const comfortUpperC = neutralTemperature + 3.5;
  const acOn = input.acEnergyKwh > 0;
  const windowOpenWithAc = input.windowOpen && acOn;
  const unnecessaryAc = acOn && input.indoorTemperatureC <= input.externalTemperatureC + 3;
  const naturalVentilationPreferred = input.externalTemperatureC + 3 < input.indoorTemperatureC
    && input.noiseDb < 60
    && input.co2Ppm <= 700
    && input.windowOpen;
  const setpointInComfortRange = input.setpointC > comfortLowerC && input.setpointC < comfortUpperC;

  // The source diagram shows several setpoint point values but its connectors
  // do not identify every branch unambiguously. Record predicates and the
  // diagram's stated values; do not invent a combined/final score.
  const setpointDiagramBands = {
    band20to23: input.setpointC > 20 && input.setpointC < 23,
    atMost21: input.setpointC <= 21,
    band24to26: input.setpointC > 24 && input.setpointC < 26,
    atLeast25: input.setpointC >= 25,
  };

  return {
    ruleVersion: 'room-flowcharts-emulation-v1',
    mode: 'LOCAL_SIMULATION_ONLY',
    occupancyAndAttribution: {
      scheduledUse: scheduled,
      sensorOccupied: occupied,
      userIdentified: scheduled || qrCheckIn,
      teacherConfirmed,
      qrCheckIn,
      result: attribution,
      monitorSensorMetrics: sessionActive,
      pointsEligible: monitor,
      metricsStillCollectedWithoutAttribution: sessionActive,
    },
    airConditioning: {
      externalTemperatureMean7dC: input.externalMean7dC,
      externalTemperatureCurrentSimulatedC: input.externalTemperatureC,
      indoorTemperatureC: input.indoorTemperatureC,
      neutralTemperatureC: round(neutralTemperature),
      comfortBandC: [round(comfortLowerC), round(comfortUpperC)],
      indoorWithinAdaptiveComfortBand: input.indoorTemperatureC >= comfortLowerC && input.indoorTemperatureC <= comfortUpperC,
      acEnergyKwh: input.acEnergyKwh,
      acOn,
      setpointC: input.setpointC,
      setpointInAdaptiveComfortRange: setpointInComfortRange,
      setpointDiagramBands,
      windowOpen: input.windowOpen,
      windowOpenWithAc,
      noiseDb: input.noiseDb,
      co2Ppm: input.co2Ppm,
      naturalVentilationPreferred,
      unnecessaryAc,
      alerts: [
        ...(windowOpenWithAc ? ['JANELA_ABERTA_COM_AC_LIGADO'] : []),
        ...(unnecessaryAc ? ['AR_CONDICIONADO_DESNECESSARIO'] : []),
        ...(!setpointInComfortRange ? ['SETPOINT_FORA_DA_FAIXA_ADAPTATIVA'] : []),
        ...(naturalVentilationPreferred ? ['PRIORIZAR_VENTILACAO_NATURAL'] : []),
      ],
      diagramPointLabels: {
        acFlow: [0, 10, 15],
        setpointFlow: [0, 2, 5, 8],
      },
      scoreResolved: false,
      scoreNote: 'A conectividade do diagrama não determina sem ambiguidade a composição dos pontos; predicates e valores exibidos são preservados sem atribuir um total.',
    },
    occupancySampling: {
      diagramCounters: { totalTime: input.sequence + 1, count: input.sequence + 1, cycle10: (input.sequence + 1) % 10 },
      sourceDiagramThresholds: { cycle10: 10, totalTime: 50 },
      unitDefinedBySource: false,
    },
  };
}

function round(value) { return Number(value.toFixed(2)); }
