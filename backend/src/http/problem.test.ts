import type { FastifyError } from 'fastify';
import { describe, expect, it } from 'vitest';
import { unprocessable } from '../shared/errors.ts';
import { problem, toProblem } from './problem.ts';

describe('problem', () => {
  it('builds an RFC 9457 body with a status title', () => {
    expect(problem(403, 'forbidden', 'No access')).toEqual({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      code: 'forbidden',
      detail: 'No access',
    });
  });

  it('omits an empty errors list', () => {
    expect(problem(400, 'x', 'y', [])).not.toHaveProperty('errors');
  });
});

describe('toProblem', () => {
  it('keeps details of application errors', () => {
    const body = toProblem(unprocessable('bad_kcal', 'Invalid', [{ path: 'kcal', message: 'too big' }]));
    expect(body).toMatchObject({
      status: 422,
      code: 'bad_kcal',
      errors: [{ path: 'kcal', message: 'too big' }],
    });
  });

  it('converts schema validation failures into field errors', () => {
    const error = Object.assign(new Error('body/kcal must be number'), {
      statusCode: 400,
      validationContext: 'body',
      validation: [
        { instancePath: '/kcal', message: 'Expected number' },
        { instancePath: '/items/0/name', message: 'Required' },
      ],
    }) as unknown as FastifyError;
    expect(toProblem(error)).toMatchObject({
      status: 400,
      code: 'validation_failed',
      errors: [
        { path: 'body.kcal', message: 'Expected number' },
        { path: 'body.items.0.name', message: 'Required' },
      ],
    });
  });

  it('passes through framework client errors', () => {
    const error = Object.assign(new Error('Request body is too large'), {
      statusCode: 413,
      code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    }) as FastifyError;
    expect(toProblem(error)).toMatchObject({ status: 413, code: 'fst_err_ctp_body_too_large' });
  });

  it('masks unexpected errors', () => {
    expect(toProblem(new Error('secret'))).toMatchObject({ status: 500, code: 'internal_error' });
  });
});
