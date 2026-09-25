export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];

  constructor(status: number, code: string, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: ErrorDetail[]) =>
  new AppError(400, code, message, details);
export const unauthorized = (code: string, message: string) => new AppError(401, code, message);
export const forbidden = (code: string, message: string) => new AppError(403, code, message);
export const notFound = (code: string, message: string) => new AppError(404, code, message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const unprocessable = (code: string, message: string, details?: ErrorDetail[]) =>
  new AppError(422, code, message, details);
export const unavailable = (code: string, message: string) => new AppError(503, code, message);
