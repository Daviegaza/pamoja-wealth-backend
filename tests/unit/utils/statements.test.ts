import { describe, expect, it } from "@jest/globals";
import { csvCell } from "../../../src/services/statements.service.js";

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises spreadsheet formula injection", () => {
    expect(csvCell("+254700")).toBe("'+254700");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("=1+1")).toBe("'=1+1");
  });

  it("renders null/undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});
