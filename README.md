# PROCEL Demo Harness

Harness para publicar telemetria no broker MQTT do ambiente demonstrativo e registrar os resultados de carga. O HTTP `202` confirma somente o ACK do broker; persistencia e avaliacao no Proben precisam ser verificadas separadamente no banco e nas APIs.

## Execucao reproduzivel

`simulate-demo.mjs` publica uma mensagem por vez em taxa controlada. O inventario em `rooms-20261112-02.json` usa dez salas e dez sensores virtuais exclusivos. Cada amostra carrega as 13 medidas definidas em `measurement-specs.json`. Temperatura interna, ocupacao, estados de equipamentos e energia sao sinteticos; temperatura externa e media externa de sete dias sao observacoes WeatherAPI gravadas no contexto compartilhado do campus DEMO.

Antes de uma carga real, associe as especificacoes aos sensores. `provision-sensor-qualifications.mjs` cria (ou completa de forma idempotente) um grupo com regras para cada parametro e o vincula como `ATIVO` aos sensores das dez salas. O gerador exige o artefato dessa preparacao e interrompe a carga se algum sensor do inventario nao tiver o grupo ativo. Regras numericas usam os limites sinteticos de `validTestRange` (`BETWEEN` = `NORMAL`, `OUTSIDE` = `ALERTA`); estados booleanos true/false sao ambos `NORMAL`, pois sao estados validos sem avaliacao normativa. Por padrao, `--anomaly-rate 0.1` injeta uma mensagem a cada dez, alternando temperatura 31 °C, umidade 91%, ruido 86 dB e CO2 2001 ppm. Os resultados devem incluir `NORMAL` e `ALERTA` de forma reproduzivel. `ALERTA` e resultado da qualificacao; a mensagem ainda deve ser aceita e persistida. Falhas HTTP sao contabilizadas separadamente. Isso exercita a qualificacao sem alegar calibracao fisica nem confundir validacao de dados com regras de contexto das salas.

Configure a chave do publisher apenas no ambiente do terminal:

```powershell
$env:PUBLISH_API_KEY = '<publisher key>'
$env:PUBLISH_URL = 'http://187.77.58.122:3000/publish'
$env:PUBLISH_PRODUCER_ID = 'tcc-demo-20261112-02'
$env:PROBEN_API_BASE_URL = 'https://procel.servehttp.com'
$env:PROBEN_ADMIN_EMAIL = '<admin email>'
$env:PROBEN_ADMIN_PASSWORD = '<admin password>'
$env:TCC_DEMO_RUN_TAG = '20261112-02'
$env:TCC_DEMO_SENSOR_TYPE = 'TCC_DEMO_SENSOR_20261112-02'
node .\provision-sensor-qualifications.mjs
npm run simulate -- --run-id 20261112-02-r1 --rooms-file rooms-20261112-02.json --qualification-file runs/tcc-20261112-02-sensor-qualifications.json --count 1000 --rate 5 --anomaly-rate 0.1 --seed 20261112 --external-mean-c 18.23 --external-temperature-c 25.6 --course-id 1 --mission-id 68614b09-fbcd-4b69-9a67-559752a82c3c --output runs/tcc-20261112-02-r1
```

Para execucoes de taxa diferentes, use novo `--run-id`, semente e pasta de saida, mantendo o mesmo inventario. `--dry-run` grava um relatorio sem publicar. Chaves nao devem ser salvas nos arquivos de execucao ou no repositorio.

## Dados e metricas

Cada pasta de execucao contem:

- `events.ndjson`: mensagem, resposta HTTP, latencia cliente-ao-publisher e trilha deterministica das regras do diagrama.
- `summary.json`: contagem de ACKs, taxa alcancada, media, desvio padrao amostral, erro padrao, percentis e intervalo de Wilson para proporcao de ACKs.
- `manifest.json`: parametros da carga, inventario, curso/missao e hash SHA-256 de `events.ndjson`.
- `server-metrics.json`: conciliacao com os registros canonicos do backend, estados de ingestao, contagens de parametros, qualificacoes por grupo e percentis de processamento no servidor.

O atraso de ponta a ponta e a taxa efetivamente persistida devem ser calculados por correlacao entre `messageId`, `raw_message_id`, `raw_source_timestamp`, `raw_received_at`, `api_received_at` e `medicao.timestamp` em `medicao_ingestao_metadata`/`medicao`. Nao interprete o ACK do broker como persistencia. Registre tambem repeticoes, rejeicoes, falhas e amostras por sala. Faça execucoes independentes para cada nivel de carga e informe as condicoes do host e a versao implantada.

`room-rules.mjs` preserva a emulacao local dos fluxogramas: ocupacao, agenda, confirmacao, QR, conforto adaptativo, AC, setpoint, janelas, ruído, CO2 e ventilacao. Os predicados ambiguos do diagrama de pontos sao registrados sem inventar uma soma. As qualificacoes por parametro persistidas pelo backend sao um caminho distinto e devem ser medidas separadamente pelas avaliacoes gravadas em `avaliacao_parametro_valor`.

## Infraestrutura demo ja cadastrada

Run tag remoto: `20261112-02`.

- Campus: `DEMO`, coordenadas WeatherAPI de Pelotas.
- Dez salas `TCCDEMO-20261112-02-R01` a `R10`, capacidade 40.
- Um sensor virtual por sala, perfil MQTT proprio e 13 especificacoes de medidas.
- Curso, disciplina, 20 alunos, agenda nas dez salas e uma missao com evento de gatilho por temperatura.
- Contexto compartilhado WeatherAPI com serie horaria real de 7 dias; media ponderada observada de 18,23 °C e cobertura registrada de 167 h em uma janela de 168 h.

Use `run-20261112-02.json`, `academic-20261112-02.json` e `mission-20261112-02.json` para os IDs de referencia. Arquivos de execucao sao experimentais; nao misture leituras externas com as geradas pelos sensores virtuais.

O grupo de qualificacao `TCC-DEMO-20261112-02-QUALIFICACAO-SENSORES` foi criado com 26 regras para 13 definicoes de parametro e associado como ativo a todos os dez sensores. O resultado verificado esta em `runs/tcc-20261112-02-sensor-qualifications.json`. Cargas executadas antes de 2026-11-12 15:41 UTC nao tinham esse grupo ativo e, portanto, nao mediram o custo nem a quantidade de avaliacoes por parametro; nao devem ser apresentadas como teste desse caminho.

## Carga com qualificacoes e alertas

Tres repeticoes independentes (`qualified-anomaly-r1` a `r3`) enviaram 300 mensagens cada, a 2 mensagens/s agregadas entre dez sensores. A taxa de anomalia foi 10%, alternando quatro valores acima das faixas sinteticas. As tres repeticoes tiveram 300/300 ACKs, aproximadamente 2,006 mensagens/s, 300 medições canônicas e 3.900 qualificacoes persistidas cada. A conciliacao da API encontrou 3.870 resultados `NORMAL` e 30 `ALERTA` por repeticao, exatamente o esperado para os valores injetados.

No conjunto: 900/900 ACKs (IC95% Wilson 99,57%–100%), 900 medições, 11.700 valores/qualificacoes, 11.610 `NORMAL` e 90 `ALERTA` (24 temperatura, 24 umidade, 21 ruido e 21 CO2). A media da latencia cliente-ACK foi 31,0 ms entre rodadas; p95 por rodada variou de 32,251 a 37,973 ms e p99 de 36,167 a 98,081 ms. Esses tempos medem somente publisher/broker, nao processamento interno da API. Os intervalos entre rodadas, limites e dados por execucao estao em `runs/tcc-20261112-02-qualified-anomaly-results.md` e `.json`; as respostas canonicas e qualificacoes estao em `server-metrics.json` dentro de cada pasta.

Os `ALERTA` sao resultados de regras de qualificacao para valores sinteticos fora de faixa; as mensagens continuaram aceitas e persistidas. Eles nao sao falhas HTTP nem atestam precisao de sensores reais. Resultados dos pilotos anteriores ao grupo de qualificacao nao devem ser combinados com estas tres repeticoes para inferir o custo dessa etapa.

O piloto `runs/tcc-20261112-02-pilot1` publicou 100 eventos a 5 eventos/s: 100 receberam HTTP 202, 100 foram persistidos e concluidos, com 1.300 valores de parametros. O atraso servidor medido entre `raw_received_at` e `api_received_at` teve media de 18,6848 s, p95 de 35,7551 s e p99 de 36,2888 s. Isso indica fila/atraso neste piloto; nao e resultado de capacidade. O relogio do cliente apresentou diferenca media de aproximadamente 128 ms, entao a latencia baseada em `sourceTimestamp` nao deve ser usada como latencia unidirecional. Consulte `sql/collect-run-metrics.sql` para obter as mesmas metricas por run.

Os buckets agregados nao sao criados durante a ingestao. Eles exigem um job em `analytics_aggregation_job` e o worker `PROBEN_ANALYTICS_AGGREGATION_WORKER_ENABLED=true`; no staging consultado havia zero jobs e zero buckets. A pagina de Analises agora permite filtrar buckets por parametro ou modelo/tipo de sensor sem exigir sensor individual ou sala.

## Simulacao ponta a ponta com missao (TCC)

Em 2026-11-12 foram executadas tres repeticoes independentes de 150 mensagens a 2 mensagens/s, distribuidas por dez salas/sensores. Cada repeticao teve uma missao nova, 20 atividades atribuidas e um dos tres eventos experimentais habilitado: `MEDICAO_RECEBIDA`, temperatura interna >=25 C, politica `ALUNOS_VINCULADOS`. O evento usou o periodo de aula ativo por sala, a disciplina demo e 20 matriculas ativas. O worker real do staging criou e processou ocorrencias; todas as 60 atividades foram concluidas.

As tres repeticoes tiveram 450/450 ACKs do publisher, 450/450 medicoes canonicas e 5.850/5.850 avaliacoes de regras conciliadas. Foram persistidas 122 ocorrencias dos tres eventos experimentais, todas processadas. O atraso medicao→worker, calculado de `inicioEm` ate `detectadoEm`, teve media de 10,19 s entre repeticoes. Cada repeticao teve 20/20 atividades concluidas. A consolidacao inclui media, desvio-padrao amostral, IC95% t com df=2, IC95% Wilson para proporcoes e p95/p99 por repeticao.

Dois eventos de temperatura fora das tres missoes de medicao geraram 200 ocorrencias adicionais, todas processadas. Um era o evento preexistente da missao TCC Demo 20261112-02; o outro foi criado na preparacao inicial, concluiu 20 atividades proprias e foi desativado depois da coleta. Ambos estao registrados em `tcc-20261112-03-background-event-observation.json`, separados das contagens especificas das novas missoes. Eles fizeram parte da carga real do staging; consulte os limites de interpretacao antes de usar os tempos como benchmark isolado.

Foi criado e concluido um job de agregacao com janelas de um minuto para o periodo das cargas: seis janelas, 60 buckets de temperatura para dez sensores. Essa serie pode ser consultada no Admin em `/analiticos` com o modelo `TCC_DEMO_SENSOR_20261112-02` e parametro `temperature`.

Relatorio e dados auditaveis:

- [Resultados estatisticos](runs/tcc-20261112-03-mission-results.md)
- [Consolidacao JSON](runs/tcc-20261112-03-mission-results.json)
- [Plano e IDs das missoes/eventos](runs/tcc-20261112-03-mission-plan.json)
- [Contexto de aulas e matriculas](runs/tcc-20261112-03-academic-context.json)
- [Evento legado concorrente](runs/tcc-20261112-03-background-event-observation.json)
- Cada pasta `runs/tcc-20261112-03-rN-mission/` contem `events.ndjson`, manifesto com SHA-256, resumo, conciliacao de medicoes/qualificacoes e metricas de ocorrencias/atividades.
- [Job de agregacao](runs/tcc-20261112-03-analytics-job.json)

Os diagramas de regras de sala continuam emulados localmente pelo harness; qualificacoes de parametros, ocorrencias e progresso de missao acima foram processados/persistidos no backend. A latencia ACK e somente publisher->broker, nao representa latencia interna da API. Leituras internas sao sinteticas e nao alegam calibracao fisica. O resumo pode ser reconstruido com `node .\summarize-mission-runs.mjs`; o script valida os hashes dos tres arquivos NDJSON antes de calcular estatisticas.

## Limpeza

`remove-demo-run.ps1` remove somente arquivos locais dentro de `runs`. Os dados remotos de staging precisam de limpeza separada no banco; arquive primeiro os resultados do TCC e use uma consulta revisada por run tag antes de excluir registros. Nao apague o campus `DEMO` nem o historico WeatherAPI compartilhado.

## Publisher local

O publisher local e broker podem ser iniciados por `docker compose up -d --build`. Copie `.env.example`, defina `PUBLISH_API_KEY` no ambiente de implantacao e mantenha a porta MQTT restrita a rede do Telemetry. `GET /health` informa se o publisher esta conectado ao broker.
