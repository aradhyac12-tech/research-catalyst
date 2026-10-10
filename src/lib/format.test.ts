import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("never shows 0.0 MB for a small real file", () => { expect(formatBytes(120 * 1024)).toBe("120 KB"); expect(formatBytes(2048)).toBe("2.0 KB"); });
  it("shows bytes for tiny files", () => expect(formatBytes(512)).toBe("512 B"));
  it("shows MB from 1 MB up", () => { expect(formatBytes(1024 * 1024)).toBe("1.00 MB"); expect(formatBytes(24.6 * 1024 * 1024)).toBe("24.6 MB"); });
  it("handles zero and bad input", () => { expect(formatBytes(0)).toBe("0 B"); expect(formatBytes(undefined)).toBe("—"); expect(formatBytes(NaN)).toBe("—"); });
});
