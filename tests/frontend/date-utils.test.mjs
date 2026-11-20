import {
  toDateInputValue,
  toTimeInputValue,
  toDateTimeLocalInputValue,
  dateTimeLocalInputToIso,
} from "../../public/js/date-utils.js";

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

describe("datetime-local helpers for the noise sequence time", () => {
  const local = new Date(2024, 2, 12, 2, 5);

  it("formats local date and time for <input type=datetime-local>", () => {
    expect(toDateTimeLocalInputValue(local)).toBe("2024-03-12T02:05");
  });

  it("reads the input back as the same instant in ISO UTC", () => {
    expect(dateTimeLocalInputToIso(toDateTimeLocalInputValue(local))).toBe(local.toISOString());
  });

  it("treats an empty or invalid value as not entered", () => {
    expect(dateTimeLocalInputToIso("")).toBeNull();
    expect(dateTimeLocalInputToIso(undefined)).toBeNull();
    expect(dateTimeLocalInputToIso("not a date")).toBeNull();
  });
});
