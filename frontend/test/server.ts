import type { FetchLike } from '../src/api/http.ts';
import { json, problem } from './http.ts';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ServerCall {
  method: string;
  path: string;
  search: string;
  body: unknown;
  authorization: string | null;
  contentType: string | null;
}

type Handler = (call: ServerCall) => Response | Promise<Response>;

interface Route {
  method: Method;
  pattern: RegExp;
  handler: Handler;
}

function compile(path: string): RegExp {
  return new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
}

export function createServer() {
  const routes: Route[] = [];
  const calls: ServerCall[] = [];

  const fetch: FetchLike = async (request) => {
    const url = new URL(request.url);
    const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.clone().text();
    let body: unknown;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const call: ServerCall = {
      method: request.method,
      path: url.pathname,
      search: url.search,
      body,
      authorization: request.headers.get('Authorization'),
      contentType: request.headers.get('Content-Type'),
    };
    calls.push(call);
    const route = [...routes]
      .reverse()
      .find((item) => item.method === request.method && item.pattern.test(url.pathname));
    if (route === undefined) return problem(404, 'route_not_found');
    return route.handler(call);
  };

  return {
    fetch,
    calls,
    on(method: Method, path: string, handler: Handler) {
      routes.push({ method, pattern: compile(path), handler });
    },
    reply(method: Method, path: string, body: unknown) {
      routes.push({ method, pattern: compile(path), handler: () => json(body) });
    },
    reset() {
      routes.length = 0;
      calls.length = 0;
    },
    callsTo(method: Method, path: string) {
      return calls.filter((call) => call.method === method && call.path === path);
    },
  };
}
