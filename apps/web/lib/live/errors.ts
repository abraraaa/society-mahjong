/** A rejection with an HTTP status, and optionally a body (a snapshot) the client can use to catch up. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
