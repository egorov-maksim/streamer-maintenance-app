const { toInt, requireValidId } = require("../utils/validation");

describe("toInt", () => {
  it("parses integer strings", () => {
    expect(toInt("42", 0)).toBe(42);
  });

  it("returns fallback on NaN input", () => {
    expect(toInt("abc", -1)).toBe(-1);
  });

  it("returns fallback on missing value", () => {
    expect(toInt(undefined, 9)).toBe(9);
  });
});

describe("requireValidId", () => {
  it("returns parsed id for valid param", () => {
    const res = { status: jest.fn(), json: jest.fn() };
    const req = { params: { id: "17" } };
    expect(requireValidId(req, res)).toBe(17);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("sends 400 and returns null for non-numeric id", () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const req = { params: { id: "x" } };
    expect(requireValidId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid id" });
  });

  it("rejects missing id", () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const req = { params: {} };
    expect(requireValidId(req, res)).toBeNull();
  });
});
