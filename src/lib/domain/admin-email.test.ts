import { describe, expect, it } from "vitest";
import { LENGTH_SPEC, RECIPIENTS_MAX, adminEmailProblem, buildDraftPrompt, cleanName, fallbackDraft, maskEmail, parseDraft, parseRecipients, renderAdminEmail } from "./admin-email";

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

  it("splits typed addresses, drops repeats, flags bad ones and caps the count", () => {
    const r = parseRecipients("Asha@Example.com, asha@example.com; bad-address\nraj@example.org <x@y.z>");
    expect(r.valid).toEqual(["asha@example.com", "raj@example.org", "x@y.z"]); // repeats (any case) dropped; <angle brackets> removed
    expect(r.invalid).toEqual(["bad-address"]);
    const many = parseRecipients(Array.from({ length: RECIPIENTS_MAX + 3 }, (_, i) => `u${i}@example.com`).join(","));
    expect(many.valid).toHaveLength(RECIPIENTS_MAX);
    expect(many.tooMany).toBe(true);
  });
  it("asks for the chosen length and passes the requested next step, never an address", () => {
    const p = buildDraftPrompt({ firstName: "Asha", instructions: "Fee waived until 30 November.", tone: "formal", length: "long", action: "Upload the manuscript." });
    expect(p).toContain(LENGTH_SPEC.long.words);
    expect(p).toContain("Upload the manuscript.");
    expect(p).not.toMatch(/@/);
    expect(buildDraftPrompt({ firstName: "", instructions: "x".repeat(20), tone: "friendly", length: "short" })).toContain(LENGTH_SPEC.short.words);
    expect(LENGTH_SPEC.short.maxOut).toBeLessThan(LENGTH_SPEC.medium.maxOut);
    expect(LENGTH_SPEC.medium.maxOut).toBeLessThan(LENGTH_SPEC.long.maxOut);
  });
  it("builds a plain draft from the notes at every length, adding no facts and no placeholders", () => {
    const notes = "the publication fee is waived until 30 November";
    const short = fallbackDraft({ firstName: "Asha", instructions: notes, length: "short" });
    const medium = fallbackDraft({ firstName: "Asha", instructions: notes, length: "medium", action: "upload the manuscript" });
    const long = fallbackDraft({ firstName: "", instructions: notes, length: "long", action: "upload the manuscript" });
    expect(short.body.startsWith("Hello Asha,")).toBe(true);
    expect(short.body).toContain("30 November");
    expect(short.body.length).toBeLessThan(medium.body.length);
    expect(medium.body.length).toBeLessThan(long.body.length);
    expect(medium.body).toContain("What we need from you: Upload the manuscript.");
    expect(long.body.startsWith("Hello,")).toBe(true);
    for (const d of [short, medium, long]) { expect(d.body.endsWith("Paperly team")).toBe(true); expect(adminEmailProblem(d.subject, d.body)).toBeNull(); }
  });
  it("writes a footer that fits someone without an account", () => {
    const ext = renderAdminEmail({ subject: "Hello there", body: "A message for you.", brand: "Paperly", audience: "external", replyable: true });
    expect(ext.text).not.toMatch(/you have a Paperly account/);
    expect(ext.text).toContain("reached you by mistake");
    expect(ext.text).toContain("You can reply");
    expect(renderAdminEmail({ subject: "Hello there", body: "A message for you.", brand: "Paperly" }).text).toContain("you have a Paperly account");
  });
  it("cleans a typed name and masks an address for the log", () => {
    expect(cleanName("  Asha\n<b>Rao</b>  ")).toBe("Asha b Rao /b");
    expect(maskEmail("asha.rao@example.com")).toBe("a***@example.com");
  });
});
