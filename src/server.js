import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import mqtt from 'mqtt';

const apiKey = process.env.PUBLISH_API_KEY;
if (!apiKey) {
  throw new Error('PUBLISH_API_KEY must be configured');
}

const mqttUrl = process.env.MQTT_URL || 'mqtt://mqtt:1883';
const client = mqtt.connect(mqttUrl, {
  protocolVersion: 5,
  reconnectPeriod: 1000,
  connectTimeout: 5000,
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
});
client.on('error', (error) => console.error('MQTT connection error:', error.message));

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

function authorized(request) {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return false;
  const actual = Buffer.from(token);
  const expected = Buffer.from(apiKey);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) {
      const error = new Error('Request body exceeds 256 KiB');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.status = 400;
    throw error;
  }
}

function validLevel(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !/[\/+\#\u0000]/.test(value) && value.trim() === value;
}

function makeEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be a JSON object');
  }
  if (!validLevel(body.producerId) || !validLevel(body.sensorId)) {
    throw new Error('producerId and sensorId must be single MQTT topic levels');
  }
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    throw new Error('payload must be a JSON object');
  }
  if (body.messageId !== undefined && (typeof body.messageId !== 'string' || !body.messageId.trim())) {
    throw new Error('messageId must be a nonempty string');
  }
  if (body.sourceTimestamp !== undefined && (typeof body.sourceTimestamp !== 'string' ||
      !Number.isFinite(Date.parse(body.sourceTimestamp)))) {
    throw new Error('sourceTimestamp must be a valid timestamp string');
  }
  const topic = `procel/telemetry/v1/${body.producerId}/${body.sensorId}/events`;
  const envelope = {
    messageId: body.messageId || randomUUID(),
    sensorId: body.sensorId,
    sourceTimestamp: body.sourceTimestamp || new Date().toISOString(),
    payload: body.payload,
  };
  return { topic, envelope };
}

const server = createServer(async (request, response) => {
  if (request.url === '/health' && request.method === 'GET') {
    return sendJson(response, client.connected ? 200 : 503, { mqttConnected: client.connected });
  }
  if (request.url !== '/publish' || request.method !== 'POST') {
    return sendJson(response, 404, { error: 'Not found' });
  }
  if (!authorized(request)) {
    return sendJson(response, 401, { error: 'Bearer token required' });
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
    return sendJson(response, 415, { error: 'Content-Type must be application/json' });
  }
  if (!client.connected) {
    return sendJson(response, 503, { error: 'MQTT broker unavailable' });
  }
  try {
    const body = await readBody(request);
    const { topic, envelope } = makeEvent(body);
    let completed = false;
    const finish = (status, result) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      sendJson(response, status, result);
    };
    const timeout = setTimeout(() => finish(504, { error: 'MQTT publish timed out' }), 10000);
    client.publish(topic, JSON.stringify(envelope), { qos: 1, retain: false }, (error) => {
      if (error) return finish(502, { error: 'MQTT publish failed' });
      finish(202, { status: 'published', topic, messageId: envelope.messageId });
    });
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`HTTP publisher listening on ${port}`));
