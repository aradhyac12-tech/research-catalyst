import { describe, expect, it } from "vitest";
import { adminEmailProblem, buildDraftPrompt, parseDraft, renderAdminEmail } from "./admin-email";

describe("admin e-mail", () => {
  it("reads a fenced or plain model answer and rejects junk", () => {
    expect(parseDraft('```json\n{"subject":"Hello there","body":"Hello Asha,\\n\\n\\n\\nThanks.\\n\\nPaperly team"}\n```')).toEqual({ subject: "Hello there", body: "Hello Asha,\n\nThanks.\n\nPaperly team" });
    expect(parseDraft("sorry I cannot")).toBeNull();
    expect(parseDraft('{"subject":"x"}')).toBeNull();
  });
  it("strips HTML and keeps the subject on one line", () => {
    const d = parseDraft('{"subject":"Hi\\nBcc: a@b.c","body":"<script>x</script>Hello there friend"}')!;
    expect(d.subject).toBe("Hi Bcc: a@b.c");
    expect(d.body).not.toContain("<");
  });
  it("blocks placeholders, empty and oversize messages", () => {
    expect(adminEmailProblem("Hi", "long enough body here")).toMatch(/subject/i);
    expect(adminEmailProblem("A subject", "short")).toMatch(/short/);
    expect(adminEmailProblem("A subject", "Dear [Name], welcome aboard")).toMatch(/placeholder/);
    expect(adminEmailProblem("A subject", "x".repeat(5001))).toMatch(/longer/);
    expect(adminEmailProblem("A subject", "Hello Asha, your account is ready.")).toBeNull();
  });
  it("escapes everything in the HTML and never links or attaches anything", () => {
    const m = renderAdminEmail({ subject: "Account <b>note</b>", body: "Hello <img src=x onerror=1>", brand: "Paperly" });
    expect(m.subject).toBe("[Paperly] Account <b>note</b>"); // the subject is plain text in the header
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img");
    expect(m.text).toContain("Hello <img src=x onerror=1>");
  });
  it("gives the model only the first name, the tone and the instructions", () => {
    const p = buildDraftPrompt({ firstName: "Asha", instructions: "Tell her the fee is waived.", tone: "friendly" });
    expect(p).toContain("Asha");
    expect(p).not.toMatch(/@/);
  });
});
