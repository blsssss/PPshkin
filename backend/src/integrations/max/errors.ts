export class MaxApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MaxApiError';
    this.status = status;
    this.code = code;
  }
}

export class UserUnreachableError extends MaxApiError {
  constructor(code: string, message: string) {
    super(403, code, message);
    this.name = 'UserUnreachableError';
  }
}

export class DownloadTooLargeError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(`Download is larger than ${limitBytes} bytes`);
    this.name = 'DownloadTooLargeError';
    this.limitBytes = limitBytes;
  }
}
