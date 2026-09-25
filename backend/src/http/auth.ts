import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext, AuthService } from '../services/auth.ts';
import { unauthorized } from '../shared/errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

export function registerAuthentication(app: FastifyInstance, auth: AuthService) {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (header === undefined) return;
    const match = BEARER.exec(header);
    if (!match?.[1]) {
      throw unauthorized('invalid_token', 'Authorization header must be "Bearer <token>"');
    }
    const context = await auth.resolveBearer(match[1]);
    if (!context) {
      throw unauthorized('invalid_token', 'Token is invalid or expired');
    }
    request.auth = context;
  });
}

export function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  return request.auth
    ? Promise.resolve()
    : Promise.reject(unauthorized('unauthorized', 'Authentication required'));
}

export function userId(request: FastifyRequest): number {
  if (!request.auth) {
    throw unauthorized('unauthorized', 'Authentication required');
  }
  return request.auth.userId;
}

export const bearerSecurity = [{ bearerAuth: [] }];
