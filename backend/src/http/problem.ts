import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { STATUS_CODES } from 'node:http';
import { AppError, type ErrorDetail } from '../shared/errors.ts';

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: ErrorDetail[];
}

export function problem(status: number, code: string, detail: string, errors?: ErrorDetail[]): Problem {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
    detail,
    ...(errors && errors.length > 0 ? { errors } : {}),
  };
}

export function sendProblem(reply: FastifyReply, body: Problem) {
  return reply.status(body.status).type('application/problem+json').send(body);
}

function validationDetails(error: FastifyError): ErrorDetail[] {
  return (error.validation ?? []).map((issue) => ({
    path: [error.validationContext, issue.instancePath.replace(/^\//, '').replaceAll('/', '.')]
      .filter((part) => part !== undefined && part !== '')
      .join('.'),
    message: issue.message ?? 'invalid value',
  }));
}

export function toProblem(error: FastifyError | AppError | Error): Problem {
  if (error instanceof AppError) {
    return problem(error.status, error.code, error.message, error.details);
  }
  const fastifyError = error as Partial<FastifyError>;
  if (fastifyError.validation) {
    return problem(
      400,
      'validation_failed',
      'Request validation failed',
      validationDetails(fastifyError as FastifyError),
    );
  }
  const status = fastifyError.statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    const code = (fastifyError.code ?? 'bad_request').toLowerCase();
    return problem(status, code, error.message);
  }
  return problem(500, 'internal_error', 'Internal server error');
}

export function registerProblemHandlers(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const body = toProblem(error);
    if (body.status >= 500) {
      request.log.error({ err: error }, 'request failed');
    }
    return sendProblem(reply, body);
  });
  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, problem(404, 'route_not_found', `Route ${request.method} ${request.url} not found`)),
  );
}
