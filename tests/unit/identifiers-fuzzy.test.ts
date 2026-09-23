import { describe, expect, it } from "vitest";
import { decodeCin, detectIdentifier, normalizeName } from "@/lib/identifiers";
import { matchScore, trigramSimilarity } from "@/lib/analysis/fuzzy";

describe("identifier detection", () => {
  it("detects CIN, LLPIN, DIN and free text", () => {
    expect(detectIdentifier(" u72900tn2017ptc999103 ")).toEqual({ kind: "cin", value: "U72900TN2017PTC999103" });
    expect(detectIdentifier("aab-1234")).toEqual({ kind: "llpin", value: "AAB-1234" });
    expect(detectIdentifier("FLLP-0042").kind).toBe("llpin");
    expect(detectIdentifier("99900101")).toEqual({ kind: "din", value: "99900101" });
    expect(detectIdentifier("Aarohan agritech").kind).toBe("text");
    expect(detectIdentifier("U72900TN2017PTC99910").kind).toBe("text"); // 20 chars
  });

  it("decodes CIN structure", () => {
    expect(decodeCin("L01110TG1994PLC018562")).toMatchObject({ listing: "Listed", nicCode: "01110", stateCode: "TG", incorporationYear: 1994, ownership: "Public Limited Company" });
    expect(decodeCin("not-a-cin")).toBeNull();
  });

  it("normalises names by stripping legal suffixes and punctuation", () => {
    expect(normalizeName("Covey Retail (OPC) Private Limited")).toBe("COVEY RETAIL");
    expect(normalizeName("A & B Pvt. Ltd.")).toBe("A AND B");
  });
});

describe("fuzzy matching", () => {
  it("scores identical names 1 and unrelated names low", () => {
    expect(matchScore("Brightwave Logistics Private Limited", "BRIGHTWAVE LOGISTICS PRIVATE LIMITED")).toBe(1);
    expect(matchScore("cedarline", "GANGOTRI TEXTILES LIMITED")).toBeLessThan(0.3);
  });

  it("tolerates typos and partial names", () => {
    expect(matchScore("brihgtwave", "BRIGHTWAVE LOGISTICS PRIVATE LIMITED")).toBeGreaterThanOrEqual(0.3);
    expect(matchScore("everstone", "EVERSTONE REALTY DEVELOPERS PRIVATE LIMITED")).toBeGreaterThanOrEqual(0.9);
    expect(matchScore("realty everstone", "EVERSTONE REALTY DEVELOPERS PRIVATE LIMITED")).toBeGreaterThan(0.5);
  });

  it("trigram similarity is symmetric and bounded", () => {
    const a = trigramSimilarity("aarohan", "aarohn");
    expect(a).toBeGreaterThan(0.3);
    expect(a).toBeLessThanOrEqual(1);
    expect(trigramSimilarity("aarohn", "aarohan")).toBeCloseTo(a);
  });
});
