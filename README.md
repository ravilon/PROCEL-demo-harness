# PROCEL Demo Harness

Recebe eventos por HTTP, publica no broker MQTT e permite testar o listener do Procel-Telemetry remoto.

```text
POST /publish -> HTTP publisher -> Mosquitto -> Procel-Telemetry (subscriber)
```

## Rodar com Docker Compose

Copie `.env.example` para `.env`, preencha `PUBLISH_API_KEY` com um valor longo e execute:

```powershell
docker compose up -d --build
```

O HTTP publisher escuta em `http://<servidor>:3000`. O Mosquitto escuta na porta `1883` do host e os containers se comunicam pela rede Docker. As portas MQTT e HTTP ficam acessiveis nas interfaces do servidor; restrinja TCP 1883 e 3000 no firewall a origens autorizadas. O `.env` deste projeto pode conter `PROCEL_MQTT_HOST` para o console antigo, mas o HTTP publisher usa `MQTT_URL=mqtt://mqtt:1883` dentro do Compose.

Envie um evento:

```powershell
$body = @{ producerId = 'demo'; sensorId = 'sensor-1'; payload = @{ temperature = 24.0 } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/publish' -Headers @{ Authorization = "Bearer $env:PUBLISH_API_KEY" } -ContentType 'application/json' -Body $body
```

Se a chave estiver apenas no arquivo `.env`, atribua-a tambem ao `$env:PUBLISH_API_KEY` no terminal que faz a requisicao. O endpoint gera `messageId` e `sourceTimestamp` se omitidos. O corpo tambem aceita esses campos:

```json
{
  "producerId": "demo",
  "sensorId": "sensor-1",
  "messageId": "demo-001",
  "sourceTimestamp": "2026-09-18T12:00:00Z",
  "payload": { "temperature": 24.0 }
}
```

O app publica o envelope em `procel/telemetry/v1/demo/sensor-1/events`, com QoS 1 e sem retained. `202` confirma o ACK do broker, nao a persistencia no Telemetry. `GET /health` mostra se a conexao com o broker esta ativa. Requisicoes a `/publish` exigem `Authorization: Bearer <PUBLISH_API_KEY>`.

## Campus demonstrativo e carga reproduzivel

`simulate-demo.mjs` gera telemetria deterministica para duas salas, com presença, iluminação e temperatura variando ao longo de uma aula simulada. Cada mensagem tem ID estável por semente e sequência, timestamp de origem, ID de sala e anotações locais de aula, missão e gatilho. As anotações de aula/missão/gatilho são metadados do experimento; elas não criam registros de aula, atividades ou eventos no backend.

Antes de publicar, cadastre no backend as salas e sensores virtuais indicados pelo próprio arquivo (`DEMO_TCC_SALA_01`, `DEMO_TCC_SALA_02` e sensores correspondentes), com o produtor `demo-tcc` e os parâmetros esperados pelo perfil de integração do Telemetry. O exemplo de sensor `IDEALSENSOR_347` não é usado. As chaves de sensor no gerador devem corresponder aos IDs cadastrados. Não envie a carga ao publisher remoto enquanto esses sensores não estiverem provisionados.

Configure a chave somente no ambiente do terminal, sem colocá-la no repositório:

```powershell
$env:PUBLISH_API_KEY = '<chave do publisher>'
$env:PUBLISH_URL = 'http://localhost:3000/publish'
npm run simulate -- --count 1000 --rate 10 --seed 20261112 --output runs/tcc-piloto-01
```

Para gerar e conferir a forma dos registros sem rede, chave ou publicação, acrescente `--dry-run`.

O gerador limita a taxa e envia uma mensagem por vez. `events.ndjson` guarda cada tentativa, status HTTP e latência cliente→publisher; `summary.json` informa taxa, percentis e intervalo Wilson de 95% da proporção de ACKs; `manifest.json` guarda parâmetros e hash SHA-256. Um HTTP `202` e essas latências representam somente o ACK MQTT do publisher. Para medir ingestão real, correlacione `messageId` com confirmação do Telemetry/banco e compute separadamente atraso de ponta a ponta, perda, duplicatas e taxa efetivamente persistida. Repetições independentes devem usar sementes diferentes e registrar carga, duração e versão do backend.

### Remoção e isolamento

Os arquivos locais de uma execução podem ser apagados com:

```powershell
.\remove-demo-run.ps1 -RunDirectory '.\runs\tcc-piloto-01'
```

Isso remove somente artefatos locais do diretório validado. Mensagens já publicadas e dados persistidos pelo Telemetry não são removidos por esse script. Para evitar poluir dados reais, rode o campus demonstrativo em uma instância/banco de demonstração isolado que possa ser descartado integralmente após o TCC. Se for obrigatório compartilhar o banco, o backend precisa oferecer uma rotina administrativa de expurgo por prefixo que percorra medições e dependências; não apague linhas diretamente nem use sensores existentes.

## Implantar no Coolify com Telemetry remoto

1. Crie uma Application do repositorio usando o build pack **Docker Compose** e `compose.yaml`.
2. Ative **Preserve Repository During Deployment**, pois `mosquitto.conf` e montado a partir do repositorio.
3. Configure `PUBLISH_API_KEY` nas variaveis da Application e atribua um dominio HTTPS ao servico `publisher`, porta interna `3000`.
4. Ative **Connect To Predefined Network** no recurso deste harness. O Telemetry e o broker precisam compartilhar a mesma rede Docker no mesmo servidor. Confira o hostname real do broker em **Show Deployable Compose**.
5. No recurso do Telemetry, defina `PROCEL_TELEMETRY_MQTT_ENABLED=true`, `PROCEL_TELEMETRY_MQTT_BROKER_URL=tcp://<hostname-interno-do-broker>:1883` e `PROCEL_TELEMETRY_MQTT_TLS_ENABLED=false`. Depois, redeploy do Telemetry.
6. Envie o `POST /publish` ao dominio HTTPS do publisher. A porta MQTT nao precisa ser aberta na internet.

O Telemetry e apenas o subscriber; Mosquitto e o broker separado deste Compose. O perfil `staging` do Telemetry liga TLS por padrao, por isso a configuracao acima desliga TLS para a conexao privada deste broker de teste. Em producao, configure autenticacao e TLS no broker.

### Se o publisher nao conectar ao broker

- `HTTP publisher listening on 1883`: a variavel `PORT` do container publisher foi configurada como porta MQTT. O HTTP deve escutar em `3000`; o Compose deste repositorio define `PORT=3000`.
- `getaddrinfo EAI_AGAIN mqtt`: o hostname `mqtt` nao esta resolvendo no container publisher. Confira se o recurso implantado no Coolify usa **Docker Compose** com os dois servicos `mqtt` e `publisher` ativos. Se o publisher foi implantado sozinho como uma Application Node/Dockerfile, `mqtt` nao existe na rede dele: implante o Compose completo ou configure `MQTT_URL` com o hostname interno real de um broker na rede compartilhada.
- `connack timeout`: confira se o servico `mqtt` esta saudavel e se o publisher usa `mqtt://mqtt:1883` quando os dois estao no mesmo Compose. O endpoint HTTP `GET /health` retorna `mqttConnected: true` quando a conexao estiver pronta.

## Console MQTT opcional

O script `mqtt-console.ps1` ainda permite publicar diretamente em um broker. Para este Compose local:

```powershell
.\mqtt-console.ps1 -HostName localhost -Topic 'procel/telemetry/v1/demo/sensor-1/events' -PayloadFile 'payloads/normal-temperature.json'
```

Ele usa `mosquitto_pub` local, se instalado, ou executa o cliente dentro do servico `mqtt` deste Compose. Para broker externo, configure `PROCEL_MQTT_HOST` e `PROCEL_MQTT_PORT` em `.env`.
