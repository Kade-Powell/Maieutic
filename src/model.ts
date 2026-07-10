export interface FocusContentInput {
  path: string;
  startLine: number;
  endLine?: number;
}

export interface PointAtContentInput {
  action: "point" | "clear";
  pointerText?: string;
  pointerOccurrence?: number;
  pointerLine?: number;
  pointerStartColumn?: number;
  pointerEndColumn?: number;
}

export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export interface ResolvedFocus {
  path: string;
  focus: TextRange;
}

export function resolveFocus(input: FocusContentInput, lines: readonly string[]): ResolvedFocus {
  const path = requireNonEmptyString(input.path, "path");
  const startLine = requirePositiveInteger(input.startLine, "startLine");
  const endLine = input.endLine === undefined ? startLine : requirePositiveInteger(input.endLine, "endLine");

  if (endLine < startLine) {
    throw new Error("endLine must be greater than or equal to startLine.");
  }
  if (endLine > lines.length) {
    throw new Error(`endLine ${endLine} is outside the document, which has ${lines.length} lines.`);
  }

  const endText = lines[endLine - 1];
  if (endText === undefined) {
    throw new Error(`Line ${endLine} does not exist.`);
  }

  return {
    path,
    focus: {
      start: { line: startLine - 1, character: 0 },
      end: { line: endLine - 1, character: endText.length },
    },
  };
}

export function resolvePointer(
  input: PointAtContentInput,
  focus: TextRange,
  lines: readonly string[],
): TextRange | undefined {
  if (input.action === "clear") {
    return undefined;
  }

  const hasExplicitPointer = [input.pointerLine, input.pointerStartColumn, input.pointerEndColumn].some(
    (value) => value !== undefined,
  );
  if (input.pointerText !== undefined && hasExplicitPointer) {
    throw new Error("Use pointerText or explicit pointer coordinates, not both.");
  }
  if (input.pointerOccurrence !== undefined && input.pointerText === undefined) {
    throw new Error("pointerOccurrence requires pointerText.");
  }
  if (input.pointerText === undefined && !hasExplicitPointer) {
    throw new Error("A point action requires pointerText or explicit pointer coordinates.");
  }

  if (input.pointerText !== undefined) {
    return resolveTextPointer(input.pointerText, input.pointerOccurrence, focus, lines);
  }
  return resolveExplicitPointer(input, focus, lines);
}

function resolveTextPointer(
  pointerText: string,
  pointerOccurrence: number | undefined,
  focus: TextRange,
  lines: readonly string[],
): TextRange {
  if (pointerText.length === 0) {
    throw new Error("pointerText must not be empty.");
  }
  const occurrence = pointerOccurrence === undefined
    ? 1
    : requirePositiveInteger(pointerOccurrence, "pointerOccurrence");
  const focusedText = lines.slice(focus.start.line, focus.end.line + 1).join("\n");

  let matchOffset = -1;
  let searchOffset = 0;
  for (let current = 0; current < occurrence; current += 1) {
    matchOffset = focusedText.indexOf(pointerText, searchOffset);
    if (matchOffset === -1) {
      throw new Error(`pointerText occurrence ${occurrence} was not found within the focused lines.`);
    }
    searchOffset = matchOffset + pointerText.length;
  }

  return {
    start: offsetToPosition(focusedText, matchOffset, focus.start.line),
    end: offsetToPosition(focusedText, matchOffset + pointerText.length, focus.start.line),
  };
}

function resolveExplicitPointer(
  input: PointAtContentInput,
  focus: TextRange,
  lines: readonly string[],
): TextRange {
  const pointerLine = requirePositiveInteger(input.pointerLine, "pointerLine");
  const pointerStartColumn = requirePositiveInteger(input.pointerStartColumn, "pointerStartColumn");
  const pointerEndColumn = requirePositiveInteger(input.pointerEndColumn, "pointerEndColumn");
  const focusStartLine = focus.start.line + 1;
  const focusEndLine = focus.end.line + 1;

  if (pointerLine < focusStartLine || pointerLine > focusEndLine) {
    throw new Error("The pointer line must be inside the focused line range.");
  }
  if (pointerEndColumn <= pointerStartColumn) {
    throw new Error("pointerEndColumn must be greater than pointerStartColumn.");
  }

  const lineText = lines[pointerLine - 1];
  if (lineText === undefined) {
    throw new Error(`Pointer line ${pointerLine} does not exist.`);
  }
  const maxColumn = lineText.length + 1;
  if (pointerStartColumn > maxColumn || pointerEndColumn > maxColumn) {
    throw new Error(`Pointer columns must be within line ${pointerLine}, whose maximum end column is ${maxColumn}.`);
  }

  return {
    start: { line: pointerLine - 1, character: pointerStartColumn - 1 },
    end: { line: pointerLine - 1, character: pointerEndColumn - 1 },
  };
}

function offsetToPosition(text: string, offset: number, startingLine: number): TextPosition {
  const segments = text.slice(0, offset).split("\n");
  return {
    line: startingLine + segments.length - 1,
    character: segments.at(-1)?.length ?? 0,
  };
}

function requirePositiveInteger(value: number | undefined, field: string): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function requireNonEmptyString(value: string | undefined, field: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}
