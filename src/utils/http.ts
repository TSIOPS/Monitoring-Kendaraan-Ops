export type OkPayload = { success: true } & Record<string, unknown>;

export function okPayload(data: Record<string, unknown> = {}): OkPayload {
  return { success: true, ...data };
}

export function errPayload(message: string, error = 'ERROR'): { success: false; error: string; message: string } {
  return { success: false, error, message };
}