\set ON_ERROR_STOP on

-- Run only against the dedicated Proben test database.
-- Example: psql ... -v run_id='20261112-01' -v room_count=10 -f provision-demo-rooms.sql
CREATE TEMP TABLE _tcc_demo_guard (ok boolean NOT NULL CHECK (ok));
INSERT INTO _tcc_demo_guard VALUES (:'run_id' ~ '^[A-Za-z0-9_-]{3,40}$');
INSERT INTO _tcc_demo_guard VALUES (:'room_count'::integer BETWEEN 2 AND 100);
INSERT INTO _tcc_demo_guard VALUES (EXISTS (SELECT 1 FROM campus WHERE nome = 'DEMO'));

BEGIN;

INSERT INTO unidade (nome)
VALUES ('TCC-DEMO-' || :'run_id')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO predio (id, campus_id, nome)
VALUES ('DEMO|TCC-DEMO-' || :'run_id', 'DEMO', 'TCC Demo ' || :'run_id')
ON CONFLICT (campus_id, nome) DO NOTHING;

INSERT INTO compartimento (
    id, tipo, predio_id, nome, unidade_id, pavimento, capacidade, area, lotacao_raw
)
SELECT
    'TCCDEMO-' || :'run_id' || '-R' || lpad(n::text, 2, '0'),
    'Sala',
    'DEMO|TCC-DEMO-' || :'run_id',
    'Sala de Demo TCC ' || lpad(n::text, 2, '0'),
    'TCC-DEMO-' || :'run_id',
    n,
    40,
    60.00,
    '40'
FROM generate_series(1, :'room_count'::integer) AS n
ON CONFLICT (id) DO UPDATE SET
    nome = EXCLUDED.nome,
    tipo = EXCLUDED.tipo,
    predio_id = EXCLUDED.predio_id,
    unidade_id = EXCLUDED.unidade_id,
    pavimento = EXCLUDED.pavimento,
    capacidade = EXCLUDED.capacidade,
    area = EXCLUDED.area,
    lotacao_raw = EXCLUDED.lotacao_raw
WHERE compartimento.predio_id = EXCLUDED.predio_id
  AND compartimento.unidade_id = EXCLUDED.unidade_id;

COMMIT;

SELECT id, nome, predio_id, unidade_id, capacidade
FROM compartimento
WHERE id LIKE 'TCCDEMO-' || :'run_id' || '-R%'
ORDER BY id;
