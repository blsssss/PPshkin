import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext, AuthService } from '../services/auth.ts';
import { unauthorized } from '../shared/errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    authRejected: boolean;
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

export function registerAuthentication(app: FastifyInstance, auth: AuthService) {
  app.decorateRequest('auth', null);
  app.decorateRequest('authRejected', false);
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (header === undefined) return;
    const token = BEARER.exec(header)?.[1];
    const context = token ? await auth.resolveBearer(token) : null;
    if (context) {
      request.auth = context;
    } else {
      request.authRejected = true;
    }
  });
}

export function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (request.auth) return Promise.resolve();
  return Promise.reject(
    request.authRejected
      ? unauthorized('invalid_token', 'Token is invalid or expired, sign in again')
      : unauthorized('unauthorized', 'Authentication required'),
  );
}

export function userId(request: FastifyRequest): number {
  if (!request.auth) {
    throw unauthorized('unauthorized', 'Authentication required');
  }
  return request.auth.userId;
}

export function rateLimitKey(request: FastifyRequest): string {
  if (request.auth?.demoRole) return `demo:${request.auth.demoRole}:${request.ip}`;
  if (request.auth) return `user:${request.auth.userId}`;
  return `ip:${request.ip}`;
}

export const bearerSecurity = [{ bearerAuth: [] }];
