# PROCEL Demo Harness

Harness para publicar telemetria no broker MQTT do ambiente demonstrativo e registrar os resultados de carga. O HTTP `202` confirma somente o ACK do broker; persistencia e avaliacao no Proben precisam ser verificadas separadamente no banco e nas APIs.

## Execucao reproduzivel

`simulate-demo.mjs` publica uma mensagem por vez em taxa controlada. O inventario em `rooms-20261112-02.json` usa dez salas e dez sensores virtuais exclusivos. Cada amostra carrega as 13 medidas definidas em `measurement-specs.json`. Temperatura interna, ocupacao, estados de equipamentos e energia sao sinteticos; temperatura externa e media externa de sete dias sao observacoes WeatherAPI gravadas no contexto compartilhado do campus DEMO.

Configure a chave do publisher apenas no ambiente do terminal:

```powershell
$env:PUBLISH_API_KEY = '<publisher key>'
$env:PUBLISH_URL = 'http://187.77.58.122:3000/publish'
$env:PUBLISH_PRODUCER_ID = 'tcc-demo-20261112-02'
npm run simulate -- --run-id 20261112-02-r1 --rooms-file rooms-20261112-02.json --count 1000 --rate 5 --seed 20261112 --external-mean-c 18.23 --external-temperature-c 25.6 --course-id 1 --mission-id 68614b09-fbcd-4b69-9a67-559752a82c3c --output runs/tcc-20261112-02-r1
```

Para execucoes de taxa diferentes, use novo `--run-id`, semente e pasta de saida, mantendo o mesmo inventario. `--dry-run` grava um relatorio sem publicar. Chaves nao devem ser salvas nos arquivos de execucao ou no repositorio.

## Dados e metricas

Cada pasta de execucao contem:

- `events.ndjson`: mensagem, resposta HTTP, latencia cliente-ao-publisher e trilha deterministica das regras do diagrama.
- `summary.json`: contagem de ACKs, taxa alcancada, media, desvio padrao amostral, erro padrao, percentis e intervalo de Wilson para proporcao de ACKs.
- `manifest.json`: parametros da carga, inventario, curso/missao e hash SHA-256 de `events.ndjson`.
- `server-metrics.json`: conciliacao com os registros canonicos do backend, estados de ingestao, contagens de parametros e percentis de processamento no servidor.

O atraso de ponta a ponta e a taxa efetivamente persistida devem ser calculados por correlacao entre `messageId`, `raw_message_id`, `raw_source_timestamp`, `raw_received_at`, `api_received_at` e `medicao.timestamp` em `medicao_ingestao_metadata`/`medicao`. Nao interprete o ACK do broker como persistencia. Registre tambem repeticoes, rejeicoes, falhas e amostras por sala. Faça execucoes independentes para cada nivel de carga e informe as condicoes do host e a versao implantada.

`room-rules.mjs` preserva a emulacao local dos fluxogramas: ocupacao, agenda, confirmacao, QR, conforto adaptativo, AC, setpoint, janelas, ruído, CO2 e ventilacao. Os predicados ambiguos do diagrama de pontos sao registrados sem inventar uma soma. Regras executaveis do backend sao cadastradas separadamente e suas execucoes devem ser exportadas junto aos resultados.

## Infraestrutura demo ja cadastrada

Run tag remoto: `20261112-02`.

- Campus: `DEMO`, coordenadas WeatherAPI de Pelotas.
- Dez salas `TCCDEMO-20261112-02-R01` a `R10`, capacidade 40.
- Um sensor virtual por sala, perfil MQTT proprio e 13 especificacoes de medidas.
- Curso, disciplina, 20 alunos, agenda nas dez salas e uma missao com evento de gatilho por temperatura.
- Contexto compartilhado WeatherAPI com serie horaria real de 7 dias; media ponderada observada de 18,23 °C e cobertura registrada de 167 h em uma janela de 168 h.

Use `run-20261112-02.json`, `academic-20261112-02.json` e `mission-20261112-02.json` para os IDs de referencia. Arquivos de execucao sao experimentais; nao misture leituras externas com as geradas pelos sensores virtuais.

O piloto `runs/tcc-20261112-02-pilot1` publicou 100 eventos a 5 eventos/s: 100 receberam HTTP 202, 100 foram persistidos e concluidos, com 1.300 valores de parametros. O atraso servidor medido entre `raw_received_at` e `api_received_at` teve media de 18,6848 s, p95 de 35,7551 s e p99 de 36,2888 s. Isso indica fila/atraso neste piloto; nao e resultado de capacidade. O relogio do cliente apresentou diferenca media de aproximadamente 128 ms, entao a latencia baseada em `sourceTimestamp` nao deve ser usada como latencia unidirecional. Consulte `sql/collect-run-metrics.sql` para obter as mesmas metricas por run.

Os buckets agregados nao sao criados durante a ingestao. Eles exigem um job em `analytics_aggregation_job` e o worker `PROBEN_ANALYTICS_AGGREGATION_WORKER_ENABLED=true`; no staging consultado havia zero jobs e zero buckets. A pagina de Analises agora permite filtrar buckets por parametro ou modelo/tipo de sensor sem exigir sensor individual ou sala.

## Limpeza

`remove-demo-run.ps1` remove somente arquivos locais dentro de `runs`. Para apagar os dados remotos, use o SQL `sql/remove-demo-run.sql` somente depois de arquivar os resultados e conferir o preview exato do run tag. O script exige o identificador completo `20261112-02` e apaga somente registros com prefixos/nome desse run, na ordem das dependencias. Dados historicos WeatherAPI e campus DEMO foram adicionados ao banco de staging e tambem estao explicitamente escopados no SQL de limpeza.

## Publisher local

O publisher local e broker podem ser iniciados por `docker compose up -d --build`. Copie `.env.example`, defina `PUBLISH_API_KEY` no ambiente de implantacao e mantenha a porta MQTT restrita a rede do Telemetry. `GET /health` informa se o publisher esta conectado ao broker.
