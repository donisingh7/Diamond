import { describe, expect, it } from "vitest";
import { normalizeJodi } from "@/modules/betting/engines/jodi.engine";
import { generateCrossing } from "@/modules/betting/engines/crossing.engine";
import { parseCopyPaste } from "@/modules/betting/engines/copy-paste.engine";
import { expandPalti } from "@/modules/betting/engines/palti.engine";
import { reverseTwoDigit } from "@/modules/betting/engines/selection";
import { normalizeBetEntry } from "@/modules/betting/engines/normalize";

const MIN = 100; // platformSettings.minimumStakePaise

describe("JODI engine — normalizeJodi", () => {
  it("keeps exact two-digit values including leading zero", () => {
    expect(normalizeJodi(["00"])).toEqual(["00"]);
    expect(normalizeJodi(["07"])).toEqual(["07"]);
    expect(normalizeJodi(["07", "22", "48"])).toEqual(["07", "22", "48"]);
  });

  it("collapses duplicates, keeping first occurrence and order (no double charge)", () => {
    expect(normalizeJodi(["07", "07", "22", "07"])).toEqual(["07", "22"]);
  });

  it.each(["7", "100", "-1", "ab", "1.0", "0x7", "", " 7"])("rejects invalid value %j", (value) => {
    expect(() => normalizeJodi([value])).toThrow(/two-digit/i);
  });

  it("rejects an empty selection list", () => {
    expect(() => normalizeJodi([])).toThrow(/at least one/i);
  });
});

describe("JODI via normalizeBetEntry — stake rules", () => {
  it("accepts a ₹1 stake (100 paise) and applies it to every selection", () => {
    const result = normalizeBetEntry({ entryMethod: "JODI", numbers: ["07", "22"] }, 100, MIN);
    expect(result.selections).toEqual([
      { number: "07", stakePaise: 100 },
      { number: "22", stakePaise: 100 },
    ]);
    expect(result.totalStakePaise).toBe(200);
    expect(result.stakePerSelectionPaise).toBe(100);
    expect(result.selectionCount).toBe(2);
  });

  it("rejects a stake below ₹1", () => {
    expect(() => normalizeBetEntry({ entryMethod: "JODI", numbers: ["07"] }, 99, MIN)).toThrow(/minimum stake/i);
  });

  it("rejects arithmetic that would exceed safe-integer precision", () => {
    expect(() =>
      normalizeBetEntry({ entryMethod: "JODI", numbers: ["00", "01"] }, Number.MAX_SAFE_INTEGER, MIN),
    ).toThrow(/precision/i);
  });

  it("retains the raw submitted numbers as source metadata without making them authoritative", () => {
    const result = normalizeBetEntry({ entryMethod: "JODI", numbers: ["07", "07", "22"] }, 100, MIN);
    expect(result.entryMetadata).toEqual({ numbers: ["07", "07", "22"] });
    expect(result.selections.map((s) => s.number)).toEqual(["07", "22"]);
  });
});

describe("CROSSING engine — generateCrossing", () => {
  it("428935 → 6 unique digits → 36 selections, unique, with self-pairs and ordered pairs", () => {
    const { uniqueDigits, uniqueDigitCount, numbers } = generateCrossing("428935");
    expect(uniqueDigits).toEqual(["4", "2", "8", "9", "3", "5"]);
    expect(uniqueDigitCount).toBe(6);
    expect(numbers).toHaveLength(36);
    expect(new Set(numbers).size).toBe(36);
    for (const selfPair of ["44", "22", "88", "99", "33", "55"]) expect(numbers).toContain(selfPair);
    for (const ordered of ["42", "24", "89", "98", "35", "53"]) expect(numbers).toContain(ordered);
  });

  it("428 → deterministic first-appearance Cartesian order", () => {
    expect(generateCrossing("428").numbers).toEqual([
      "44", "42", "48",
      "24", "22", "28",
      "84", "82", "88",
    ]);
  });

  it("duplicate source digits do not multiply selections (4428 → unique 4,2,8 → 9)", () => {
    const { uniqueDigits, numbers } = generateCrossing("4428");
    expect(uniqueDigits).toEqual(["4", "2", "8"]);
    expect(numbers).toHaveLength(9);
  });

  it("preserves leading zero (012 → includes 00 01 02 10 ...)", () => {
    const { numbers } = generateCrossing("012");
    expect(numbers).toEqual(["00", "01", "02", "10", "11", "12", "20", "21", "22"]);
  });

  it("all ten digits → exactly 100 selections (inherent maximum)", () => {
    const { numbers } = generateCrossing("0123456789");
    expect(numbers).toHaveLength(100);
    expect(new Set(numbers).size).toBe(100);
  });

  it.each(["", "12a", "12 34", "-1"])("rejects non-digit input %j", (value) => {
    expect(() => generateCrossing(value)).toThrow(/digits/i);
  });
});

describe("COPY PASTE engine — parseCopyPaste (no Palti)", () => {
  it("parses a contiguous even-length run", () => {
    expect(parseCopyPaste("2215489635")).toEqual(["22", "15", "48", "96", "35"]);
  });

  it.each([
    ["spaces", "22 15 48 96 35"],
    ["commas", "22,15,48,96,35"],
    ["dots", "22.15.48.96.35"],
    ["mixed + padding", "  22, 15 . 48 96,35 "],
  ])("treats %s as equivalent separators", (_label, input) => {
    expect(parseCopyPaste(input)).toEqual(["22", "15", "48", "96", "35"]);
  });

  it("preserves leading-zero values", () => {
    expect(parseCopyPaste("00 07 10")).toEqual(["00", "07", "10"]);
    expect(parseCopyPaste("000710")).toEqual(["00", "07", "10"]);
  });

  it("returns the raw ordered sequence — duplicates are not removed at parse time", () => {
    expect(parseCopyPaste("22 22 15")).toEqual(["22", "22", "15"]);
  });

  it.each(["1", "123", "22,1,48", "ab22", "", "   ", "22-15", "2,,,"])(
    "fails closed on malformed input %j",
    (value) => {
      expect(() => parseCopyPaste(value)).toThrow();
    },
  );
});

describe("COPY PASTE via normalizeBetEntry — without Palti", () => {
  it("duplicates collapse, first order preserved, no reverse pairs inserted", () => {
    const result = normalizeBetEntry(
      { entryMethod: "COPY_PASTE", rawInput: "22 15 15 48 96 35", palti: false },
      1000,
      MIN,
    );
    expect(result.selections.map((s) => s.number)).toEqual(["22", "15", "48", "96", "35"]);
    expect(result.entryMetadata).toEqual({ rawInput: "22 15 15 48 96 35", palti: false });
    expect(result.engineMetadata.parsedNumbers).toEqual(["22", "15", "48", "96", "35"]);
  });

  it("contiguous 2215489635 → 22,15,48,96,35", () => {
    const result = normalizeBetEntry(
      { entryMethod: "COPY_PASTE", rawInput: "2215489635", palti: false },
      1000,
      MIN,
    );
    expect(result.selections.map((s) => s.number)).toEqual(["22", "15", "48", "96", "35"]);
  });
});

describe("PALTI engine — expandPalti", () => {
  it("reverseTwoDigit basics", () => {
    expect(reverseTwoDigit("15")).toBe("51");
    expect(reverseTwoDigit("07")).toBe("70");
    expect(reverseTwoDigit("10")).toBe("01");
    expect(reverseTwoDigit("22")).toBe("22");
  });

  it("2215489635 with Palti → 22,15,51,48,84,96,69,35,53", () => {
    expect(expandPalti(["22", "15", "48", "96", "35"])).toEqual([
      "22", "15", "51", "48", "84", "96", "69", "35", "53",
    ]);
  });

  it.each([
    [["22"], ["22"]],
    [["00"], ["00"]],
    [["07"], ["07", "70"]],
    [["10"], ["10", "01"]],
  ])("single number %j → %j", (input, expected) => {
    expect(expandPalti(input)).toEqual(expected);
  });

  it("de-duplicates globally — 12,21 with Palti stays 12,21 (not four)", () => {
    expect(expandPalti(["12", "21"])).toEqual(["12", "21"]);
  });
});

describe("COPY PASTE via normalizeBetEntry — with Palti", () => {
  it("produces the frozen expected canonical sequence and records palti:true metadata", () => {
    const result = normalizeBetEntry(
      { entryMethod: "COPY_PASTE", rawInput: "2215489635", palti: true },
      1000,
      MIN,
    );
    expect(result.selections.map((s) => s.number)).toEqual([
      "22", "15", "51", "48", "84", "96", "69", "35", "53",
    ]);
    expect(result.entryMetadata).toEqual({ rawInput: "2215489635", palti: true });
    expect(result.selectionCount).toBe(9);
    expect(result.totalStakePaise).toBe(9000);
  });
});

describe("normalizeBetEntry — CROSSING stake application", () => {
  it("6 unique digits at ₹10 → 36 selections, ₹360 total, ₹10 each", () => {
    const result = normalizeBetEntry({ entryMethod: "CROSSING", digits: "428935" }, 1000, MIN);
    expect(result.selectionCount).toBe(36);
    expect(result.stakePerSelectionPaise).toBe(1000);
    expect(result.totalStakePaise).toBe(36000);
    expect(result.selections.every((s) => s.stakePaise === 1000)).toBe(true);
    expect(result.engineMetadata).toMatchObject({ uniqueDigitCount: 6, uniqueDigits: ["4", "2", "8", "9", "3", "5"] });
  });
});
