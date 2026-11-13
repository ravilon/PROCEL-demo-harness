import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiBaseUrl = (process.env.PROBEN_API_BASE_URL ?? 'https://procel.servehttp.com').replace(/\/+$/, '');
const email = process.env.PROBEN_ADMIN_EMAIL;
const password = process.env.PROBEN_ADMIN_PASSWORD;
const runTag = process.env.TCC_DEMO_RUN_TAG ?? '20261112-02';
const sensorTypeName = process.env.TCC_DEMO_SENSOR_TYPE ?? 'TCC_DEMO_SENSOR_20261112-02';
if (!email || !password) throw new Error('Defina PROBEN_ADMIN_EMAIL e PROBEN_ADMIN_PASSWORD apenas no ambiente do processo.');
if (!/^[A-Za-z0-9_-]{3,40}$/.test(runTag)) throw new Error('TCC_DEMO_RUN_TAG invalido.');

const specsPath = resolve('measurement-specs.json');
const roomsPath = resolve(`rooms-${runTag}.json`);
const specs = JSON.parse(await readFile(specsPath, 'utf8'));
const rooms = JSON.parse(await readFile(roomsPath, 'utf8'));
if (!Array.isArray(specs.parameters) || !Array.isArray(rooms) || rooms.length === 0) {
  throw new Error('Especificacoes ou inventario de salas invalidos.');
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    throw new Error(`${method} ${path} retornou ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

const login = await request('/api/auth/login', {
  method: 'POST',
  body: { email, password },
});
const token = login.accessToken;
if (!token) throw new Error('Login nao retornou accessToken.');

const parameterDefs = await request(`/api/rules/parameter-defs?tipoNome=${encodeURIComponent(sensorTypeName)}`, { token });
const defsByName = new Map(parameterDefs.map((definition) => [definition.nome, definition]));
const missing = specs.parameters.map((parameter) => parameter.name).filter((name) => !defsByName.has(name));
if (missing.length) throw new Error(`Parametros nao cadastrados no tipo ${sensorTypeName}: ${missing.join(', ')}`);

const groupName = `TCC-DEMO-${runTag}-QUALIFICACAO-SENSORES`;
const groups = await request('/api/rules/groups', { token });
let group = groups.find((candidate) => candidate.nome === groupName);
let groupCreated = false;
if (!group) {
  group = await request('/api/rules/groups', {
    token,
    method: 'POST',
    body: {
      nome: groupName,
      descricao: `Especificacoes sinteticas de qualificacao por parametro para sensores do experimento TCC ${runTag}. Faixas derivadas de measurement-specs.json; nao representam calibracao fisica.`,
      ativo: true,
    },
  });
  groupCreated = true;
}

const existingRules = await request(`/api/rules/groups/${group.id}/rules`, { token });
const createdRules = [];
const expectedRules = [];
for (const parameter of specs.parameters) {
  const definition = defsByName.get(parameter.name);
  const common = {
    parametroDefId: definition.id,
    descricao: parameter.meaning ?? `Especificacao sintetica de qualificacao para ${parameter.name}.`,
    severidade: 0,
    prioridade: 0,
    ativo: true,
  };
  if (parameter.dataType === 'NUMERIC') {
    if (!Array.isArray(parameter.validTestRange) || parameter.validTestRange.length !== 2) {
      throw new Error(`Faixa validTestRange ausente para ${parameter.name}.`);
    }
    const [min, max] = parameter.validTestRange;
    expectedRules.push(
      { ...common, nome: `${parameter.name}: dentro da faixa sintetica`, operador: 'BETWEEN', valorNumeric1: min, valorNumeric2: max, resultado: 'NORMAL' },
      { ...common, nome: `${parameter.name}: fora da faixa sintetica`, operador: 'OUTSIDE', valorNumeric1: min, valorNumeric2: max, resultado: 'ALERTA', severidade: 1 },
    );
  } else if (parameter.dataType === 'BOOLEAN') {
    expectedRules.push(
      { ...common, nome: `${parameter.name}: estado false observado`, operador: 'EQ', valorBoolean: false, resultado: 'NORMAL' },
      { ...common, nome: `${parameter.name}: estado true observado`, operador: 'EQ', valorBoolean: true, resultado: 'NORMAL' },
    );
  } else {
    throw new Error(`dataType ${parameter.dataType} nao possui especificacao automatizada para ${parameter.name}.`);
  }
}

for (const rule of expectedRules) {
  const existing = existingRules.find((candidate) => candidate.nome === rule.nome);
  if (existing) {
    if (existing.parametroDefId !== rule.parametroDefId || existing.operador !== rule.operador || existing.resultado !== rule.resultado) {
      throw new Error(`Ja existe regra ${rule.nome} com configuracao divergente; nenhuma alteracao destrutiva foi feita.`);
    }
    continue;
  }
  const created = await request(`/api/rules/groups/${group.id}/rules`, { token, method: 'POST', body: rule });
  createdRules.push({ id: created.id, nome: created.nome, parametroDefId: created.parametroDefId });
}

const rules = await request(`/api/rules/groups/${group.id}/rules`, { token });
const expectedParameterIds = new Set(expectedRules.map((rule) => rule.parametroDefId));
if (!Array.from(expectedParameterIds).every((id) => rules.some((rule) => rule.parametroDefId === id && rule.ativo))) {
  throw new Error('Validacao final: nem todos os parametros possuem regra ativa no grupo.');
}

const currentLinks = await Promise.all(rooms.map(async (room) => ({
  room,
  links: await request(`/api/rules/sensors/${encodeURIComponent(room.sensorId)}/groups`, { token }),
})));
const roomsToLink = currentLinks
  .filter(({ links }) => !links.some((link) => link.grupoRegraId === group.id && link.status === 'ATIVO'))
  .map(({ room }) => room.roomId);

let bulkLinkResult = { salasSelecionadas: 0, sensoresVinculados: 0, vinculos: [] };
if (roomsToLink.length) {
  bulkLinkResult = await request(`/api/rules/groups/${group.id}/rooms`, {
    token,
    method: 'POST',
    body: { compartimentoIds: roomsToLink, status: 'ATIVO', validoDe: new Date().toISOString(), validoAte: null },
  });
}

const finalLinks = await Promise.all(rooms.map(async (room) => ({
  roomId: room.roomId,
  sensorId: room.sensorId,
  links: await request(`/api/rules/sensors/${encodeURIComponent(room.sensorId)}/groups`, { token }),
})));
const unlinked = finalLinks.filter(({ links }) => !links.some((link) => link.grupoRegraId === group.id && link.status === 'ATIVO'));
if (unlinked.length) throw new Error(`Validacao final: sensores sem grupo ativo: ${unlinked.map((item) => item.sensorId).join(', ')}`);

const artifact = {
  createdAt: new Date().toISOString(),
  runTag,
  sensorTypeName,
  group: { id: group.id, name: group.nome, created: groupCreated },
  parameterCount: specs.parameters.length,
  activeRuleCount: rules.filter((rule) => rule.ativo).length,
  createdRuleCount: createdRules.length,
  createdRules,
  roomCount: rooms.length,
  sensorLinks: finalLinks.map(({ roomId, sensorId, links }) => ({
    roomId,
    sensorId,
    activeGroupLinked: links.some((link) => link.grupoRegraId === group.id && link.status === 'ATIVO'),
  })),
  bulkLinkResult: {
    roomsSelected: bulkLinkResult.salasSelecionadas,
    sensorsLinked: bulkLinkResult.sensoresVinculados,
  },
  ruleSemantics: 'Numeric values inside validTestRange -> NORMAL; outside -> ALERTA. Boolean states true/false -> NORMAL because each state is valid and not inherently good/bad. All thresholds describe synthetic test data, not physical calibration.',
};
const out = resolve(`runs/tcc-${runTag}-sensor-qualifications.json`);
await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ artifact: out, ...artifact }, null, 2));
