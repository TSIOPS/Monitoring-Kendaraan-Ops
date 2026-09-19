import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type OkPayload = { success: true } & Record<string, unknown>;

export function okPayload(data: Record<string, unknown> = {}): OkPayload {
  return { success: true, ...data };
}

export function errPayload(message: string, error = 'ERROR'): { success: false; error: string; message: string } {
  return { success: false, error, message };
}

export class HttpError extends Error {
  status: ContentfulStatusCode;
  error: string;
  constructor(status: ContentfulStatusCode, message: string, error = 'ERROR') {
    super(message);
    this.status = status;
    this.error = error;
  }
}

export function reqIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? '';
}