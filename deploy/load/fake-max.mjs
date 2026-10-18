import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8081);
const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const subscriptions = new Map();
const counts = new Map();
let nextMessage = 1;

const ok = { success: true };

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function route(method, path) {
  if (method === 'GET' && path === '/health') return 'health';
  if (method === 'GET' && path === '/stats') return 'stats';
  if (method === 'GET' && path === '/me') return 'me';
  if (method === 'PATCH' && path === '/me/commands') return 'commands';
  if (path === '/subscriptions') return `subscriptions:${method}`;
  if (path === '/messages' && (method === 'POST' || method === 'PUT')) return `messages:${method}`;
  if (method === 'POST' && path === '/answers') return 'answers';
  if (method === 'POST' && path === '/uploads') return 'uploads';
  if (method === 'POST' && path === '/upload') return 'upload';
  if (method === 'POST' && /^\/chats\/-?\d+\/actions$/.test(path)) return 'actions';
  return null;
}

async function handle(request, response) {
  const url = new URL(request.url ?? '/', publicUrl);
  const name = route(request.method ?? 'GET', url.pathname);
  const body = await readJson(request);
  if (name === null) {
    send(response, 404, { code: 'not.found', message: `No method ${request.method} ${url.pathname}` });
    return;
  }
  counts.set(name, (counts.get(name) ?? 0) + 1);
  switch (name) {
    case 'health':
      send(response, 200, ok);
      return;
    case 'stats':
      send(response, 200, Object.fromEntries(counts));
      return;
    case 'me':
      send(response, 200, { user_id: 1, first_name: 'ППшкин', username: 'ppshkin_load_bot' });
      return;
    case 'subscriptions:GET':
      send(response, 200, { subscriptions: [...subscriptions.values()] });
      return;
    case 'subscriptions:POST':
      subscriptions.set(body?.url, { url: body?.url, time: Date.now(), update_types: body?.update_types ?? null });
      send(response, 200, ok);
      return;
    case 'subscriptions:DELETE':
      subscriptions.delete(url.searchParams.get('url'));
      send(response, 200, ok);
      return;
    case 'messages:POST':
      send(response, 200, { message: { body: { mid: `mid.load.${nextMessage++}` } } });
      return;
    case 'uploads':
      send(response, 200, { url: `${publicUrl}/upload` });
      return;
    case 'upload':
      send(response, 200, { photos: { load: { token: `photo-${nextMessage++}` } } });
      return;
    default:
      send(response, 200, ok);
  }
}

createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error('fake max request failed', error);
    send(response, 500, { code: 'internal', message: 'fake max failed' });
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`fake max listening on ${port}`);
});
