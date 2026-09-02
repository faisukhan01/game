/**
 * VOIDSTRIKE — typed API client for the web frontend.
 */

export interface ApiErrorShape {
  error: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<never> {
  let message = `REQUEST_FAILED (${res.status})`;
  try {
    const body = (await res.json()) as Partial<ApiErrorShape>;
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    // Keep the default message.
  }
  throw new ApiError(res.status, message);
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}
