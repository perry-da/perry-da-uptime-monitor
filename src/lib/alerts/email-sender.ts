export interface AlertEmail {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSender {
  send(email: AlertEmail): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Test/dev double — records every call so ISC-53/54/55/58/62's TRIGGER-and-PAYLOAD logic
 * can be verified without a real transactional-email account. Per the Advisor (ISA
 * Decisions): this proves the incident logic calls send() with the right recipient/content
 * at the right transitions, NOT that a real email is deliverable — that claim belongs to
 * the adapter below, which is explicitly unverified in this sandbox.
 */
export class FakeEmailSender implements EmailSender {
  public sent: AlertEmail[] = [];
  async send(email: AlertEmail) {
    this.sent.push(email);
    return { ok: true };
  }
}

/**
 * Real transactional-email adapter (Resend, per ISA Constraints). NOT exercised by any
 * test in this repo — no RESEND_API_KEY exists in this sandbox. Thin by design: all the
 * logic worth testing (trigger conditions, payload construction, idempotency) lives in
 * incidents.ts against the EmailSender interface, not here. Flagged `[DEFERRED-VERIFY]`
 * in ISA Verification — do not treat a passing incidents.test.ts as having exercised this.
 */
export class ResendEmailSender implements EmailSender {
  constructor(private apiKey: string) {}

  async send(email: AlertEmail): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "alerts@uptime-monitor.example",
          to: email.to,
          subject: email.subject,
          text: email.body,
        }),
      });
      if (!res.ok) return { ok: false, error: `resend_status_${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
