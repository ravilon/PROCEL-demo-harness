# TCC Demo — missões, gatilhos e carga

## Protocolo

Três repetições independentes, cada uma com 150 mensagens a 2 mensagens/s distribuídas por dez sensores virtuais em dez salas. Cada repetição teve uma missão nova, 20 atividades previamente atribuídas e um único gatilho ativo: medição recebida com temperatura interna maior ou igual a 25 °C. O contexto real de processamento usou o período de aula ativo e os 20 vínculos acadêmicos ativos do curso/disciplina demo.

## Resultados conciliados

- ACK publisher/broker: 450/450 (100.00%; IC95% Wilson 99.15%–100.00%).
- Medições canônicas: 450/450; valores e avaliações de regras: 5850/5850. Todas as três conciliações foram completas.
- Qualificações persistidas: 5805 NORMAL e 45 ALERTA; ALERTA corresponde às anomalias sintéticas intencionais.
- Ocorrências de missão: 122; processadas: 122. Média por repetição 40.67, DP amostral 0.58, IC95% t 39.23–42.10.
- Atraso medição→worker (inicioEm→detectadoEm): média por repetição 10188.31 ms, DP amostral 276.87 ms, IC95% t 9500.53–10876.09 ms.
- Eventos fora das três missões de medição: 200 ocorrências adicionais, 200 processadas. A missão criada na preparação concluiu 20/20 atividades próprias. Esses resultados foram separados dos contadores do gatilho novo, mas compõem a carga real observada no staging.
- Atividades: 60/60 concluídas (100.00%; IC95% Wilson 93.98%–100.00%).
- Buckets de temperatura: 60 pontos, dez sensores e seis janelas de um minuto; job 87839652-81b7-4fe0-b47d-c7a32ed52565 terminou COMPLETED.

## Estatísticas entre repetições (n=3)

| Medida | Média | DP amostral | IC95% t (df=2) |
|---|---:|---:|---:|
| Taxa alcançada | 2.0125 msg/s | 0.0001 | 2.0123–2.0127 |
| Ocorrências de missão | 40.67 | 0.58 | 39.23–42.10 |
| Taxa de ocorrência/mensagem | 27.11% | 0.38% | 26.15%–28.07% |
| ACK médio publisher/broker | 31.384 ms | 0.894 ms | 29.163 ms–33.606 ms |
| ACK p95 por repetição | 37.665 ms | 1.426 ms | 34.123 ms–41.208 ms |
| Atraso medição→worker | 10188.309 ms | 276.870 ms | 9500.526 ms–10876.091 ms |

| Repetição | ACK | Ocorrências processadas | Atividades concluídas | Taxa msg/s | ACK médio / p95 / p99 | Worker médio / p95 |
|---|---:|---:|---:|---:|---:|---:|
| 20261112-03-r1-mission | 150/150 | 40/40 | 20/20 | 2.0125 | 31.24 / 38.87 / 69.36 ms | 10076.46 / 19611.39 ms |
| 20261112-03-r2-mission | 150/150 | 41/41 | 20/20 | 2.0125 | 30.57 / 38.03 / 55.47 ms | 10503.61 / 15049.68 ms |
| 20261112-03-r3-mission | 150/150 | 41/41 | 20/20 | 2.0124 | 32.34 / 36.09 / 90.21 ms | 9984.86 / 14950.01 ms |

## Limites de interpretação

A latência ACK mede apenas publisher→broker. O atraso do worker é medido entre o timestamp da medição (inicioEm) e a detecção processada (detectadoEm), e não deve ser confundido com tempo de resposta HTTP. Persistência canônica e avaliações foram confirmadas separadamente por API; ocorrência de gatilho e conclusão de atividade foram confirmadas depois do worker assíncrono. Dois outros eventos de temperatura geraram 200 ocorrências na janela e foram contabilizados à parte; a missão de preparação concluiu 20 atividades próprias. O evento de preparação foi desativado após a carga; o evento TCC-02 preexistente permaneceu ativo. Leituras internas e regras ambientais são sintéticas; não representam precisão de sensor físico. O fluxo local dos diagramas de salas e os eventos/missões persistidos são métricas distintas.

## Artefatos

- `tcc-20261112-03-mission-results.json`: consolidação estatística e IDs do job.
- `tcc-20261112-03-mission-plan.json`: IDs de curso, alunos, missões e gatilhos.
- `tcc-20261112-03-academic-context.json`: períodos de aula e vínculos acadêmicos verificados.
- `tcc-20261112-03-background-event-observation.json`: evento legado e ocorrências concorrentes fora das métricas das novas missões.
- `20261112-03-r1-mission/`: eventos NDJSON, manifesto/hash, resumo, conciliação de medições/avaliações e métricas de ocorrências/atividades.
- `20261112-03-r2-mission/`: eventos NDJSON, manifesto/hash, resumo, conciliação de medições/avaliações e métricas de ocorrências/atividades.
- `20261112-03-r3-mission/`: eventos NDJSON, manifesto/hash, resumo, conciliação de medições/avaliações e métricas de ocorrências/atividades.
- `tcc-20261112-03-analytics-job.json`: progresso e resultado do job de agregação.

