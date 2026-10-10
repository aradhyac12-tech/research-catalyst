// Minimal SMTP client over implicit TLS (port 465), used for Gmail with an App Password. No npm dependency.
// The caller passes a ready MIME message (see domain/gmail-mime.ts). Never log `pass` or the message body.
import tls from "node:tls";

export interface SmtpOptions {
  user: string; pass: string; from: string; to: string[]; message: string;
  host?: string; port?: number; timeoutMs?: number; rejectUnauthorized?: boolean;
}
interface Reply { code: number; text: string }

export function smtpSend(o: SmtpOptions): Promise<string> {
  const host = o.host ?? "smtp.gmail.com";
  const port = o.port ?? 465;
  return new Promise<string>((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: o.rejectUnauthorized ?? true });
    const replies: Reply[] = [];
    let waiter: ((r: Reply | Error) => void) | null = null;
    let buf = ""; let lines: string[] = []; let finished = false; let failure: Error | null = null;
    const fail = (e: Error) => { failure ??= e; if (waiter) { const w = waiter; waiter = null; w(e); } };
    const timer = setTimeout(() => fail(new Error("SMTP timeout")), o.timeoutMs ?? 20000);
    sock.setEncoding("utf8");
    sock.on("error", (e) => fail(e));
    sock.on("close", () => { if (!finished) fail(new Error("SMTP connection closed")); });
    sock.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2); lines.push(line);
        if (/^\d{3}( |$)/.test(line)) {
          const r = { code: Number(line.slice(0, 3)), text: lines.map((l) => l.slice(4)).join(" ") }; lines = [];
          if (waiter) { const w = waiter; waiter = null; w(r); } else replies.push(r);
        }
      }
    });
    const read = () => new Promise<Reply>((res, rej) => {
      if (failure) return rej(failure);
      const q = replies.shift(); if (q) return res(q);
      waiter = (r) => (r instanceof Error ? rej(r) : res(r));
    });
    const expect = async (codes: number[]) => {
      const r = await read();
      if (!codes.includes(r.code)) throw new Error(`SMTP ${r.code} ${r.text.slice(0, 120)}`);
      return r;
    };
    const send = async (line: string, codes: number[]) => { sock.write(`${line}\r\n`); return expect(codes); };

    (async () => {
      await expect([220]);
      await send(`EHLO paperly.local`, [250]);
      await send(`AUTH PLAIN ${Buffer.from(`\0${o.user}\0${o.pass}`).toString("base64")}`, [235]);
      await send(`MAIL FROM:<${o.from}>`, [250]);
      for (const rcpt of o.to) await send(`RCPT TO:<${rcpt}>`, [250, 251]);
      await send("DATA", [354]);
      // Normalise line endings, then dot-stuff so a line starting with "." cannot end the message early.
      const body = o.message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      sock.write(`${body}\r\n.\r\n`);
      const done = await expect([250]);
      finished = true;
      sock.write("QUIT\r\n");
      return done.text;
    })().then(resolve, reject).finally(() => { clearTimeout(timer); finished = true; sock.destroy(); });
  });
}
