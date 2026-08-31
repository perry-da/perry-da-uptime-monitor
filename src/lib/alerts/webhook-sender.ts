export interface WebhookPayload {
  event: "incident.open" | "incident.recovery";
  monitorId: string;
  monitorName: string;
  status: "up" | "down";
  failureReason?: string;
  durationSeconds?: number;
  timestamp: string;
}

/**
 * ISC-60, ISC-61: POST to the monitor's configured webhook_url. Failure (non-2xx, timeout,
 * network error) is caught and reported, never thrown — the caller (incidents.ts) must be
 * free to treat this channel as independent of the email channel (ISC-61).
 */
export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  opts: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}
