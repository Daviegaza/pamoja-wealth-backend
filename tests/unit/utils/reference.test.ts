import { describe, it, expect } from "@jest/globals";
import { generateReference, generateInviteCode, generateOtpCode } from "../../../src/utils/reference.js";

describe("generateReference", () => {
  it("uses the supplied prefix", () => {
    expect(generateReference("TX")).toMatch(/^TX/);
  });
  it("defaults to PW prefix", () => {
    expect(generateReference()).toMatch(/^PW/);
  });
  it("emits 128 bits of entropy (~26 base32 chars)", () => {
    const r = generateReference("");
    expect(r.length).toBeGreaterThanOrEqual(24);
  });
  it("collision resistance: 10k samples all unique", () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) set.add(generateReference());
    expect(set.size).toBe(10_000);
  });
});

describe("generateInviteCode", () => {
  it("returns a 12-char base32 code", () => {
    const c = generateInviteCode();
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });
  it("10k samples all unique", () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) set.add(generateInviteCode());
    expect(set.size).toBe(10_000);
  });
});

describe("generateOtpCode", () => {
  it("returns 6 digits", () => {
    expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });
});
