import { escapeHtml } from "../../public/js/ui.js";

describe("escapeHtml", () => {
  it("neutralises markup so stored text cannot inject elements", () => {
    expect(escapeHtml('<img src=x onerror="x">')).toBe("&lt;img src=x onerror=&quot;x&quot;&gt;");
  });

  it("escapes ampersands and single quotes", () => {
    expect(escapeHtml("rope & 'knife'")).toBe("rope &amp; &#39;knife&#39;");
  });

  it("renders null and undefined as an empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("stringifies numbers", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});
