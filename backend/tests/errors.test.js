const { sendError } = require("../utils/errors");

describe("sendError", () => {
  it("sets status and sends JSON error body", () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    sendError(res, 404, "Not found");
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Not found" });
  });

  it("supports 400 validation style messages", () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    sendError(res, 400, "Invalid id");
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid id" });
  });
});
