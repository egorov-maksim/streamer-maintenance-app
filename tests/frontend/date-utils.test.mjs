import { toDateInputValue, toTimeInputValue } from "../../public/js/date-utils.js";

describe("date input helpers use the local calendar, not UTC", () => {
  // Built with the local-time constructor, so the expected strings hold in any TZ.
  const local = new Date(2024, 2, 12, 2, 5); // 12 March 2024, 02:05 local

  it("formats the local date for <input type=date>", () => {
    expect(toDateInputValue(local)).toBe("2024-03-12");
  });

  it("formats the local time for <input type=time>", () => {
    expect(toTimeInputValue(local)).toBe("02:05");
  });

  it("round-trips through the local-time parse the forms use", () => {
    const parsed = new Date(`${toDateInputValue(local)}T${toTimeInputValue(local)}`);
    expect(parsed.getTime()).toBe(local.getTime());
  });
});
