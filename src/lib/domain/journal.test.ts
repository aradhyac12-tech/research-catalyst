import { describe, expect, it } from "vitest";
import { journalIssueLine, orderTeacherFirst, numberAffiliations, looksLikeSection } from "./journal";

describe("journal helpers", () => {
  it("formats the volume/issue/month line", () => {
    expect(journalIssueLine("2026-05-14T10:00:00Z")).toBe("Volume:01/Issue:05/May-2026");
    expect(journalIssueLine("2027-10-01T00:00:00Z")).toBe("Volume:02/Issue:10/October-2027");
  });
  it("puts the teacher first and numbers affiliations by author", () => {
    const a = [{ n: "S1", a: "Student, Faculty X" }, { n: "T", a: "Lecturer, Faculty X" }, { n: "S2", a: "Student, Faculty X" }];
    const o = orderTeacherFirst(a, (x) => x.a);
    expect(o.map((x) => x.n)).toEqual(["T", "S1", "S2"]);
    expect(numberAffiliations(o, (x) => x.a)).toEqual([{ numbers: [1], text: "Lecturer, Faculty X" }, { numbers: [2, 3], text: "Student, Faculty X" }]);
  });
  it("recognises main section headings", () => {
    expect(looksLikeSection("Abstract")).toBe(true);
    expect(looksLikeSection("INTRODUCTION")).toBe(true);
    expect(looksLikeSection("The tract runs down the spinal cord.")).toBe(false);
  });
});
