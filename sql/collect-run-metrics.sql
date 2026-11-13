\set ON_ERROR_STOP on

-- Usage:
-- psql ... -v run_id='20261112-02-r2-rep1' \
--   -v producer_id='tcc-demo-20261112-02' \
--   -v event_id='10549c4e-760d-40ba-bfed-c7c178d6a40f' \
--   -v qualification_group_id='c6ecc364-ddd8-4e35-aa57-c8d697f4c497' \
--   -f sql/collect-run-metrics.sql
-- Run only against the staging database and preserve every result with the run.

\echo '=== ingestion counts and server-side processing latency (seconds) ==='
WITH run_rows AS (
    SELECT metadata.*, measurement.timestamp AS measurement_timestamp
    FROM medicao_ingestao_metadata metadata
    LEFT JOIN medicao measurement ON measurement.id = metadata.medicao_id
    WHERE metadata.original_producer_id = :'producer_id'
      AND metadata.raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%'
)
SELECT count(*) AS ingested_events,
       count(DISTINCT raw_message_id) AS unique_message_ids,
       count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
       count(*) FILTER (WHERE medicao_id IS NOT NULL) AS linked_measurements,
       count(*) FILTER (WHERE status <> 'COMPLETED') AS not_completed,
       round(avg(extract(epoch FROM (api_received_at - raw_received_at)))::numeric, 4) AS mean_server_processing_seconds,
       round((percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM (api_received_at - raw_received_at))))::numeric, 4) AS p50_server_processing_seconds,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (api_received_at - raw_received_at))))::numeric, 4) AS p95_server_processing_seconds,
       round((percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM (api_received_at - raw_received_at))))::numeric, 4) AS p99_server_processing_seconds,
       round(avg(extract(epoch FROM (raw_received_at - raw_source_timestamp)))::numeric, 4) AS mean_source_clock_skew_seconds,
       min(raw_received_at) AS first_raw_received_at,
       max(raw_received_at) AS last_raw_received_at,
       min(measurement_timestamp) AS first_measurement_timestamp,
       max(measurement_timestamp) AS last_measurement_timestamp
FROM run_rows;

\echo '=== ingestion states ==='
SELECT status, count(*) AS events
FROM medicao_ingestao_metadata
WHERE original_producer_id = :'producer_id'
  AND raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%'
GROUP BY status
ORDER BY status;

\echo '=== canonical measurement and parameter counts ==='
SELECT count(DISTINCT measurement.id) AS measurements,
       count(value.id) AS parameter_values,
       count(DISTINCT value.parametro_def_id) AS distinct_parameters
FROM medicao_ingestao_metadata metadata
JOIN medicao measurement ON measurement.id = metadata.medicao_id
LEFT JOIN parametro_valor value ON value.medicao_id = measurement.id
WHERE metadata.original_producer_id = :'producer_id'
  AND metadata.raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%';

\echo '=== per-parameter sample counts ==='
SELECT parameter.id AS parameter_id,
       parameter.nome AS parameter_name,
       parameter.numeric_unit AS unit,
       count(value.id) AS samples
FROM medicao_ingestao_metadata metadata
JOIN parametro_valor value ON value.medicao_id = metadata.medicao_id
JOIN parametro_def parameter ON parameter.id = value.parametro_def_id
WHERE metadata.original_producer_id = :'producer_id'
  AND metadata.raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%'
GROUP BY parameter.id, parameter.nome, parameter.numeric_unit
ORDER BY parameter.nome;

\echo '=== evaluations produced by the sensor qualification group ==='
SELECT evaluation.resultado,
       count(*) AS evaluations,
       count(DISTINCT value.id) AS parameter_values_evaluated,
       count(DISTINCT measurement.id) AS measurements_evaluated
FROM medicao_ingestao_metadata metadata
JOIN medicao measurement ON measurement.id = metadata.medicao_id
JOIN parametro_valor value ON value.medicao_id = measurement.id
JOIN avaliacao_parametro_valor evaluation ON evaluation.parametro_valor_id = value.id
JOIN regra_parametro rule ON rule.id = evaluation.regra_parametro_id
WHERE metadata.original_producer_id = :'producer_id'
  AND metadata.raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%'
  AND rule.grupo_regra_id = :'qualification_group_id'::uuid
GROUP BY evaluation.resultado
ORDER BY evaluation.resultado;

\echo '=== mission event occurrences ==='
SELECT status, count(*) AS occurrences,
       min(detectado_em) AS first_detected_at,
       max(detectado_em) AS last_detected_at
FROM evento_ocorrencia
WHERE evento_definicao_id = :'event_id'::uuid
  AND sensor_external_id IN (
      SELECT DISTINCT sensor_external_id
      FROM medicao_ingestao_metadata
      WHERE original_producer_id = :'producer_id'
        AND raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%'
  )
  AND detectado_em >= (SELECT min(raw_received_at) FROM medicao_ingestao_metadata
                       WHERE original_producer_id = :'producer_id'
                         AND raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%')
  AND detectado_em <= (SELECT max(raw_received_at) + interval '10 minutes' FROM medicao_ingestao_metadata
                       WHERE original_producer_id = :'producer_id'
                         AND raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%')
GROUP BY status
ORDER BY status;

\echo '=== aggregation pipeline status ==='
SELECT status, count(*) AS windows, sum(completed_windows) AS completed_windows,
       sum(failed_windows) AS failed_windows
FROM analytics_aggregation_job
WHERE requested_from < (SELECT max(timestamp) FROM medicao m
                        JOIN medicao_ingestao_metadata md ON md.medicao_id=m.id
                        WHERE md.original_producer_id = :'producer_id'
                          AND md.raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%')
  AND requested_to > (SELECT min(timestamp) FROM medicao m
                      JOIN medicao_ingestao_metadata md ON md.medicao_id=m.id
                      WHERE md.original_producer_id = :'producer_id'
                        AND md.raw_message_id LIKE 'tcc-demo-' || :'run_id' || '-%')
GROUP BY status
ORDER BY status;
