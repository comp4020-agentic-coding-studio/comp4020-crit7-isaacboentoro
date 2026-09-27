// Turning P&C's requisite prose into something enforceable, conservatively.
//
// The prose varies a lot, and only some of it is machine-checkable:
//
//   COMP1110  "must have completed: COMP1100 OR COMP1130 OR COMP1730"  → rule
//   COMP8410  "COMP7240 or COMP6240 ; and COMP6730 or COMP7230"        → rule
//   COMP2100  "COMP1110 or COMP1140 AND 6 units of 1000 level MATH"    → null
//   COMP3600  "24 units of COMP coded courses AND (6 units of MATH…)"  → null
//   COMP3620  "COMP1110 /1140 AND COMP2620"                            → null
//
// Anything counted in units, scoped to a level, or written in the "/1140"
// shorthand is left unparsed on purpose. Guessing at those would mean
// telling a student they can't take a course they're eligible for, which is
// worse than not checking at all — so those courses keep their prose and go
// unenforced.
export type Rule =
  | { kind: "course"; code: string }
  | { kind: "all"; of: Rule[] }
  | { kind: "any"; of: Rule[] };

const COURSE_CODE = /^[A-Z]{4}\d{4}[A-Z]?$/;

// P&C writes the prerequisite half as "to enrol ... you must have
// (successfully) completed[ the following]: <expr>", and often follows it
// with incompatibility prose that must not be read as a requirement.
const PREREQUISITE =
  /to enrol in this course,?\s*you must have (?:successfully )?completed(?: the following)?:?\s*([\s\S]*?)(?:\.|$|you are not able to enrol|you cannot enrol|incompatible with)/i;

type Token = { type: "code" | "and" | "or" | "sep" | "(" | ")"; value?: string };

function tokenise(source: string): Token[] | null {
  const tokens: Token[] = [];
  // ";" and "," separate whole groups, which is stronger than either
  // conjunction; P&C usually writes "; and", where the "and" only restates
  // what the separator already means.
  const normalised = source.replace(/[;,]\s*and\b/gi, " ; ").replace(/[;,]/g, " ; ");
  for (const raw of normalised.split(/\s+|(?=[();])|(?<=[();])/)) {
    const word = raw.trim();
    if (!word) continue;
    if (word === "(" || word === ")") tokens.push({ type: word });
    else if (word === ";") tokens.push({ type: "sep" });
    else if (/^and$/i.test(word)) tokens.push({ type: "and" });
    else if (/^or$/i.test(word)) tokens.push({ type: "or" });
    else if (COURSE_CODE.test(word.toUpperCase())) {
      tokens.push({ type: "code", value: word.toUpperCase() });
    } else return null; // a unit count, a level, "/1140" — not ours to judge
  }
  return tokens.length > 0 ? tokens : null;
}

function parseTokens(tokens: Token[]): Rule | null {
  let at = 0;
  const peek = (): Token | undefined => tokens[at];

  function factor(): Rule | null {
    const token = peek();
    if (!token) return null;
    if (token.type === "code") {
      at++;
      return { kind: "course", code: token.value as string };
    }
    if (token.type === "(") {
      at++;
      const inner = group();
      if (!inner || peek()?.type !== ")") return null;
      at++;
      return inner;
    }
    return null;
  }

  // One group of courses joined by a single conjunction. A group that mixes
  // "and" and "or" without brackets is refused rather than guessed at: P&C
  // writes "COMP1110 or COMP1140 AND 6 units of MATH" meaning
  // "(COMP1110 or COMP1140) AND ...", which is the opposite of the usual
  // precedence, so there is no safe reading of an unbracketed mix.
  function group(): Rule | null {
    const parts: Rule[] = [];
    const joins = new Set<string>();
    for (;;) {
      const next = factor();
      if (!next) return null;
      parts.push(next);
      const token = peek();
      if (token?.type !== "and" && token?.type !== "or") break;
      joins.add(token.type);
      at++;
    }
    if (parts.length === 1) return parts[0];
    if (joins.size !== 1) return null;
    return joins.has("or") ? { kind: "any", of: parts } : { kind: "all", of: parts };
  }

  // Separated groups are all required.
  const groups: Rule[] = [];
  for (;;) {
    const next = group();
    if (!next) return null;
    groups.push(next);
    if (peek()?.type !== "sep") break;
    at++;
  }
  if (at !== tokens.length) return null;
  return groups.length === 1 ? groups[0] : { kind: "all", of: groups };
}

/** The enforceable rule in a requisite blurb, or null when it isn't one. */
export function parseRequisite(text: string): Rule | null {
  const match = text.match(PREREQUISITE);
  if (!match) return null;
  const tokens = tokenise(match[1]);
  return tokens ? parseTokens(tokens) : null;
}

export function meetsRequisite(rule: Rule, completed: Set<string>): boolean {
  if (rule.kind === "course") return completed.has(rule.code);
  if (rule.kind === "all") return rule.of.every((part) => meetsRequisite(part, completed));
  return rule.of.some((part) => meetsRequisite(part, completed));
}

/** The courses a rule mentions, for telling someone what they're missing. */
export function codesIn(rule: Rule): string[] {
  if (rule.kind === "course") return [rule.code];
  return [...new Set(rule.of.flatMap(codesIn))];
}
