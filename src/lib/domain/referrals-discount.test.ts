import { describe, expect, it } from "vitest";
import { cleanAge, cleanPersonName, MAX_DISCOUNT_MINOR, parseRupees, splitDiscount } from "./referrals";

describe("splitDiscount: only uploaders share the amount", () => {
  it("one uploader gets everything", () => expect(splitDiscount(20000, 1)).toEqual([20000]));
  it("divides evenly", () => expect(splitDiscount(30000, 3)).toEqual([10000, 10000, 10000]));
  it("always adds up to the total, extra paise go to the earliest uploaders", () => {
    const parts = splitDiscount(10000, 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });
  it("nothing is owed with no uploaders", () => expect(splitDiscount(10000, 0)).toEqual([]));
  it("rejects nonsense", () => { expect(splitDiscount(-1, 2)).toEqual([]); expect(splitDiscount(1.5, 2)).toEqual([]); expect(splitDiscount(100, 1.5)).toEqual([]); });
  it("zero discount splits into zeros", () => expect(splitDiscount(0, 2)).toEqual([0, 0]));
});

describe("parseRupees", () => {
  it("reads rupees as paise", () => { expect(parseRupees("250")).toBe(25000); expect(parseRupees("250.5")).toBe(25050); expect(parseRupees("1,200.00")).toBe(120000); expect(parseRupees("₹99")).toBe(9900); expect(parseRupees("0")).toBe(0); });
  it("refuses bad input", () => { for (const t of ["", "abc", "-5", "1.234", "1e3", "12.", ".5", "999999999"]) expect(parseRupees(t)).toBeNull(); });
  it("respects the ceiling", () => { expect(parseRupees(String(MAX_DISCOUNT_MINOR / 100))).toBe(MAX_DISCOUNT_MINOR); expect(parseRupees(String(MAX_DISCOUNT_MINOR / 100 + 1))).toBeNull(); });
});

describe("name and age", () => {
  it("accepts a real name and tidies spaces", () => expect(cleanPersonName("  Asha   Rao ", "x@y.z")).toBe("Asha Rao"));
  it("refuses empty, one letter, digits only, 'Researcher' and the e-mail prefix", () => {
    for (const n of ["", " ", "A", "12345", "Researcher", "asha"]) expect(cleanPersonName(n, "asha@example.com")).toBeNull();
    expect(cleanPersonName(undefined)).toBeNull(); expect(cleanPersonName(42)).toBeNull();
  });
  it("accepts non-Latin names", () => expect(cleanPersonName("आशा राव")).toBe("आशा राव"));
  it("age is whole years from 10 to 100", () => {
    expect(cleanAge(21)).toBe(21); expect(cleanAge("21")).toBe(21); expect(cleanAge(" 21 ")).toBe(21);
    for (const a of [9, 101, 21.5, "", "abc", "2e1", -3, null, undefined, "1000"]) expect(cleanAge(a)).toBeNull();
  });
});

import { bestLinkDiscount, linkDiscountOnFee, MIN_PAYABLE_MINOR } from "./referrals";

describe("linkDiscountOnFee: the full amount comes off one person's fee", () => {
  it("takes the whole amount off", () => expect(linkDiscountOnFee(80000, 20000)).toEqual({ discountMinor: 20000, finalMinor: 60000 }));
  it("never leaves less than Rs 1 payable", () => {
    expect(linkDiscountOnFee(80000, 80000)).toEqual({ discountMinor: 80000 - MIN_PAYABLE_MINOR, finalMinor: MIN_PAYABLE_MINOR });
    expect(linkDiscountOnFee(80000, 5_000_000).finalMinor).toBe(MIN_PAYABLE_MINOR);
  });
  it("zero or negative discount changes nothing", () => { expect(linkDiscountOnFee(80000, 0).finalMinor).toBe(80000); expect(linkDiscountOnFee(80000, -5).finalMinor).toBe(80000); });
  it("a fee already at the floor gets no discount", () => expect(linkDiscountOnFee(MIN_PAYABLE_MINOR, 500)).toEqual({ discountMinor: 0, finalMinor: MIN_PAYABLE_MINOR }));
  it("bad numbers are harmless", () => expect(linkDiscountOnFee(NaN, 100)).toEqual({ discountMinor: 0, finalMinor: 0 }));
});

describe("bestLinkDiscount: links never add up", () => {
  it("picks the largest", () => expect(bestLinkDiscount([{ amountMinor: 100 }, { amountMinor: 300 }, { amountMinor: 200 }])?.amountMinor).toBe(300));
  it("ignores zero and returns null when nothing qualifies", () => { expect(bestLinkDiscount([{ amountMinor: 0 }])).toBeNull(); expect(bestLinkDiscount([])).toBeNull(); });
});
