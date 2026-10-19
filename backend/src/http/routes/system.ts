import type { FastifyError, LogLevel } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { HealthService } from '../../services/health.ts';
import { CSP_REPORT_MAX_BYTES, CSP_REPORT_TYPES, cspViolations, parseReportJson } from '../csp.ts';
import type { HttpMetrics } from '../metrics.ts';
import { problem, sendProblem } from '../problem.ts';
import { errorResponses, noContent, probeErrorResponses, success } from '../schemas/common.ts';

const CSP_REPORTS_PER_MINUTE = 30;

const REPORT_ERRORS: Record<string, ReturnType<typeof problem>> = {
  FST_ERR_CTP_BODY_TOO_LARGE: problem(
    413,
    'report_too_large',
    `CSP report is larger than ${CSP_REPORT_MAX_BYTES / 1024} KB`,
  ),
  FST_ERR_CTP_INVALID_MEDIA_TYPE: problem(
    415,
    'unsupported_report_type',
    `Send the report as ${CSP_REPORT_TYPES.join(' or ')}`,
  ),
};

const cspReportRoutes: FastifyPluginCallbackZod<{ metrics: HttpMetrics }> = (app, { metrics }, done) => {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(CSP_REPORT_TYPES, { parseAs: 'string' }, (_request, body, parsed) => {
    parsed(null, parseReportJson(String(body)));
  });
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const known = REPORT_ERRORS[error.code];
    if (known) return sendProblem(reply, known);
    throw error;
  });

  app.post(
    '/csp-reports',
    {
      bodyLimit: CSP_REPORT_MAX_BYTES,
      config: {
        rateLimit: {
          max: CSP_REPORTS_PER_MINUTE,
          timeWindow: '1 minute',
          keyGenerator: (request) => `csp:${request.ip}`,
        },
      },
      schema: {
        operationId: 'reportCspViolation',
        tags: ['system'],
        summary: 'Отчёт браузера о нарушении Content Security Policy',
        description: `Принимает отчёты, которые браузер отправляет по директиве report-uri, без входа. Тело в формате application/csp-report или application/reports+json, не больше ${CSP_REPORT_MAX_BYTES / 1024} КБ. Отчёты не сохраняются: сервер считает нарушения по директивам и пишет директиву и заблокированный адрес без query в журнал. Коды ошибок: report_too_large (413), unsupported_report_type (415), rate_limited (429, не больше ${CSP_REPORTS_PER_MINUTE} отчётов в минуту с одного IP).`,
        consumes: CSP_REPORT_TYPES,
        body: z
          .unknown()
          .describe('Объект с полем csp-report или массив отчётов Reporting API с типом csp-violation'),
        response: {
          204: noContent('Отчёт принят'),
          ...errorResponses(413, 415),
        },
      },
    },
    async (request, reply) => {
      for (const violation of cspViolations(request.body)) {
        metrics.cspViolation(violation.directive);
        request.log.warn(violation, 'content security policy violation reported');
      }
      return reply.status(204).send(null);
    },
  );
  done();
};

export const systemRoutes: FastifyPluginCallbackZod<{
  health: HealthService;
  metrics: HttpMetrics;
  probeLogLevel: LogLevel;
}> = (app, { health, metrics, probeLogLevel }, done) => {
  app.get(
    '/health',
    {
      logLevel: probeLogLevel,
      config: { rateLimit: false },
      schema: {
        operationId: 'getHealth',
        tags: ['system'],
        summary: 'Проверка, что процесс жив',
        response: {
          200: success('Процесс работает', z.object({ status: z.literal('ok') })),
          ...probeErrorResponses(),
        },
      },
    },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/ready',
    {
      logLevel: probeLogLevel,
      schema: {
        operationId: 'getReadiness',
        tags: ['system'],
        summary: 'Готовность к работе, проверяет базу данных',
        response: {
          200: success('Сервис готов', z.object({ status: z.literal('ready') })),
          ...probeErrorResponses(429, 503),
        },
      },
    },
    async (_request, reply) => {
      if (await health.databaseReachable()) return { status: 'ready' as const };
      return sendProblem(reply, problem(503, 'database_unavailable', 'Database is not reachable'));
    },
  );

  void app.register(cspReportRoutes, { prefix: '/api/v1', metrics });
  done();
};
