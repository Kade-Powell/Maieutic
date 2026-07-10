import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFocus, resolvePointer, type TextRange } from "../../src/model.js";

const lines = [
  "function greet(name: string) {",
  "  const message = `Hello ${name}`;",
  "  return message;",
  "}",
];

const focus: TextRange = {
  start: { line: 0, character: 0 },
  end: { line: 2, character: 17 },
};

describe("resolveFocus", () => {
  it("resolves an inclusive 1-based line range", () => {
    assert.deepEqual(
      resolveFocus(
        {
          path: "src/example.ts",
          startLine: 1,
          endLine: 3,
        },
        lines,
      ),
      {
        path: "src/example.ts",
        focus,
      },
    );
  });

  it("defaults endLine to startLine", () => {
    assert.deepEqual(resolveFocus({ path: "src/example.ts", startLine: 2 }, lines).focus, {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 34 },
    });
  });

  it("rejects a range outside the document", () => {
    assert.throws(
      () => resolveFocus({ path: "src/example.ts", startLine: 2, endLine: 5 }, lines),
      /outside the document/,
    );
  });
});

describe("resolvePointer", () => {
  it("resolves pointer text within the existing focus", () => {
    assert.deepEqual(
      resolvePointer({ action: "point", pointerText: "return message" }, focus, lines),
      {
        start: { line: 2, character: 2 },
        end: { line: 2, character: 16 },
      },
    );
  });

  it("selects a requested repeated text occurrence", () => {
    const singleLineFocus: TextRange = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 13 },
    };
    assert.deepEqual(
      resolvePointer(
        { action: "point", pointerText: "value", pointerOccurrence: 2 },
        singleLineFocus,
        ["value + value"],
      ),
      {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 13 },
      },
    );
  });

  it("resolves explicit 1-based columns with an exclusive end", () => {
    assert.deepEqual(
      resolvePointer(
        {
          action: "point",
          pointerLine: 2,
          pointerStartColumn: 9,
          pointerEndColumn: 16,
        },
        focus,
        lines,
      ),
      {
        start: { line: 1, character: 8 },
        end: { line: 1, character: 15 },
      },
    );
  });

  it("clears only the pointer", () => {
    assert.equal(resolvePointer({ action: "clear" }, focus, lines), undefined);
  });

  it("requires a target for point", () => {
    assert.throws(
      () => resolvePointer({ action: "point" }, focus, lines),
      /requires pointerText or explicit pointer coordinates/,
    );
  });

  it("rejects a pointer outside the focus", () => {
    assert.throws(
      () => resolvePointer(
        {
          action: "point",
          pointerLine: 4,
          pointerStartColumn: 1,
          pointerEndColumn: 2,
        },
        focus,
        lines,
      ),
      /inside the focused line range/,
    );
  });

  it("rejects missing pointer text occurrences", () => {
    assert.throws(
      () => resolvePointer({ action: "point", pointerText: "not present" }, focus, lines),
      /was not found/,
    );
  });

  it("rejects pointerOccurrence without pointerText", () => {
    assert.throws(
      () => resolvePointer({ action: "point", pointerOccurrence: 2 }, focus, lines),
      /requires pointerText/,
    );
  });
});
