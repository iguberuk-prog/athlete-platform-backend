/**
 * Email via Resend (https://resend.com). Set RESEND_API_KEY and EMAIL_FROM
 * (a sender on a domain verified in Resend, e.g. "Athlete Performance <reports@yourdomain.com>").
 * Without a key, emails are skipped and logged, so nothing breaks in development.
 */

export interface Email { to: string[]; subject: string; html: string; text: string }

export interface Mailer { send(e: Email): Promise<{ sent: boolean; id?: string; error?: string }> }

export class ResendMailer implements Mailer {
  async send(e: Email) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) {
      console.log(`[email skipped: RESEND_API_KEY/EMAIL_FROM not set] to=${e.to.length} subject=${e.subject}`);
      return { sent: false, error: "not_configured" };
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: e.to, subject: e.subject, html: e.html, text: e.text }),
        signal: ctl.signal,
      });
      const j: any = await res.json().catch(() => ({}));
      return res.ok ? { sent: true, id: j.id } : { sent: false, error: j.message || `HTTP ${res.status}` };
    } catch (err) {
      return { sent: false, error: (err as Error).message };
    } finally {
      clearTimeout(t);
    }
  }
}

/** Test double: collects emails. */
export class MemoryMailer implements Mailer {
  sent: Email[] = [];
  async send(e: Email) { this.sent.push(e); return { sent: true, id: String(this.sent.length) }; }
}

export const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
