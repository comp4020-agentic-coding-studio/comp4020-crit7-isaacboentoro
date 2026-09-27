import { describe, expect, it } from "vitest";
import { codesIn, meetsRequisite, parseRequisite } from "../src/lib/requisites";

// The prose in these cases is verbatim from P&C course pages, so this pins
// down the line between what the app enforces and what it only displays.
describe("parsing requisite prose", () => {
  it("parses a plain list of alternatives", () => {
    const rule = parseRequisite(
      "To enrol in this course you must have completed: COMP1100 OR COMP1130 OR COMP1730 . You are not able to enrol in this course if you have completed COMP1140 or COMP6710 or COMP7710 .",
    );
    expect(rule).toEqual({
      kind: "any",
      of: [
        { kind: "course", code: "COMP1100" },
        { kind: "course", code: "COMP1130" },
        { kind: "course", code: "COMP1730" },
      ],
    });
  });

  it("stops at the incompatibility sentence", () => {
    // COMP1140 appears only in the "not able to enrol" half, so it must not
    // end up read as something you need
    const rule = parseRequisite(
      "To enrol in this course you must have completed: COMP1100 . You are not able to enrol in this course if you have completed COMP1140 .",
    );
    expect(codesIn(rule!)).toEqual(["COMP1100"]);
  });

  it("treats a semicolon as separating whole groups, not as a plain and", () => {
    const rule = parseRequisite(
      "To enrol in this course you must have completed COMP7240 or COMP6240 or COMP2400 ; and COMP6730 or COMP7230 or COMP6710 .",
    );
    // one from each half — NOT "…or (COMP2400 and COMP6730) or…"
    expect(rule).toEqual({
      kind: "all",
      of: [
        {
          kind: "any",
          of: [
            { kind: "course", code: "COMP7240" },
            { kind: "course", code: "COMP6240" },
            { kind: "course", code: "COMP2400" },
          ],
        },
        {
          kind: "any",
          of: [
            { kind: "course", code: "COMP6730" },
            { kind: "course", code: "COMP7230" },
            { kind: "course", code: "COMP6710" },
          ],
        },
      ],
    });
    expect(meetsRequisite(rule!, new Set(["COMP2400", "COMP6710"]))).toBe(true);
    expect(meetsRequisite(rule!, new Set(["COMP7240", "COMP6240"]))).toBe(false);
  });

  it("refuses to guess at an unbracketed mix of and and or", () => {
    // P&C reads this as "(A or B) and C", the opposite of the usual
    // precedence, so there is no safe reading without brackets
    expect(
      parseRequisite("To enrol in this course you must have completed COMP1100 or COMP1130 and COMP2620 ."),
    ).toBeNull();
    // brackets make it unambiguous, so this one is enforced
    expect(
      parseRequisite(
        "To enrol in this course you must have completed ( COMP1100 OR COMP1130 ) AND COMP2620 .",
      ),
    ).toEqual({
      kind: "all",
      of: [
        {
          kind: "any",
          of: [
            { kind: "course", code: "COMP1100" },
            { kind: "course", code: "COMP1130" },
          ],
        },
        { kind: "course", code: "COMP2620" },
      ],
    });
  });

  it("parses a single required course", () => {
    expect(parseRequisite("To enrol in this course, you must have completed COMP3900 .")).toEqual({
      kind: "course",
      code: "COMP3900",
    });
  });

  it("refuses anything counted in units or scoped to a level", () => {
    // enforcing a guess at these would block students who are eligible
    expect(
      parseRequisite(
        "To enrol in this course you must have successfully completed: COMP1110 or COMP1140 AND 6 units of 1000 level MATH.",
      ),
    ).toBeNull();
    expect(
      parseRequisite(
        "To enrol in this course you must have completed the following: 24 units of COMP coded courses AND (6 units of MATH OR COMP1600 )",
      ),
    ).toBeNull();
    // the "/1140" shorthand isn't a course code
    expect(
      parseRequisite("To enrol in this course you must have completed: COMP1110 /1140 AND COMP2620 ."),
    ).toBeNull();
  });

  it("has no rule when the prose is only about incompatibility", () => {
    expect(parseRequisite("Incompatible with COMP1130 .")).toBeNull();
    expect(
      parseRequisite("You cannot enrol in this course if you have completed COMP6261 or ENGN8534 ."),
    ).toBeNull();
  });
});

describe("checking a rule against completed courses", () => {
  const rule = parseRequisite(
    "To enrol in this course you must have completed: COMP1100 OR COMP1130 . ",
  )!;

  it("is met by any one of the alternatives", () => {
    expect(meetsRequisite(rule, new Set(["COMP1130"]))).toBe(true);
    expect(meetsRequisite(rule, new Set(["COMP1100", "MATH1013"]))).toBe(true);
  });

  it("is not met by an unrelated course", () => {
    expect(meetsRequisite(rule, new Set())).toBe(false);
    expect(meetsRequisite(rule, new Set(["MATH1013"]))).toBe(false);
  });

  it("requires every part of an and", () => {
    const both = parseRequisite(
      "To enrol in this course you must have completed COMP1110 and COMP2620 .",
    )!;
    expect(meetsRequisite(both, new Set(["COMP1110"]))).toBe(false);
    expect(meetsRequisite(both, new Set(["COMP1110", "COMP2620"]))).toBe(true);
  });
});
