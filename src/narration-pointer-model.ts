import type { TextPosition, TextRange } from "./model.js";

const MAX_NARRATION_POINTER_CUES = 8;
const MIN_POINTER_DELAY_MS = 150;
const MIN_POINTER_GAP_MS = 450;
const BASE_WORDS_PER_MINUTE = 165;

export interface NarrationPointerCue {
  narrationOffset: number;
  pointerText: string;
  range: TextRange;
}

export interface ScheduledNarrationPointerCue extends NarrationPointerCue {
  delayMs: number;
}

export function deriveNarrationPointerCues(
  markdown: string,
  narration: string,
  focusedText: string,
  focusStart: TextPosition,
): NarrationPointerCue[] {
  const source = markdown.replace(/```[\s\S]*?```/gu, "");
  const cues: NarrationPointerCue[] = [];
  let narrationSearchOffset = 0;

  for (const match of source.matchAll(/`([^`\r\n]+)`/gu)) {
    const mention = match[1]?.trim();
    if (mention === undefined || mention.length === 0) {
      continue;
    }
    const narrationOffset = findCaseInsensitive(narration, mention, narrationSearchOffset);
    if (narrationOffset === -1) {
      continue;
    }
    narrationSearchOffset = narrationOffset + mention.length;

    const resolved = resolveMention(mention, focusedText, focusStart);
    if (resolved === undefined) {
      continue;
    }
    const previous = cues.at(-1);
    if (previous?.range.start.line === resolved.range.start.line
      && previous.range.start.character === resolved.range.start.character
      && previous.range.end.line === resolved.range.end.line
      && previous.range.end.character === resolved.range.end.character) {
      continue;
    }
    cues.push({ narrationOffset, ...resolved });
    if (cues.length === MAX_NARRATION_POINTER_CUES) {
      break;
    }
  }
  return cues;
}

export function scheduleNarrationPointerCues(
  cues: readonly NarrationPointerCue[],
  narration: string,
  speed: number,
): ScheduledNarrationPointerCue[] {
  if (cues.length === 0 || narration.length === 0) {
    return [];
  }
  const durationMs = estimateNarrationDurationMs(narration, speed);
  let previousDelay = -MIN_POINTER_GAP_MS;

  return cues.map((cue) => {
    const proportionalDelay = Math.round((cue.narrationOffset / narration.length) * durationMs);
    const delayMs = Math.max(MIN_POINTER_DELAY_MS, proportionalDelay, previousDelay + MIN_POINTER_GAP_MS);
    previousDelay = delayMs;
    return { ...cue, delayMs };
  });
}

export function estimateNarrationDurationMs(narration: string, speed: number): number {
  const wordCount = narration.match(/\S+/gu)?.length ?? 0;
  const normalizedSpeed = Number.isFinite(speed) ? Math.max(0.25, Math.min(4, speed)) : 1;
  const spokenMs = (wordCount / (BASE_WORDS_PER_MINUTE * normalizedSpeed)) * 60_000;
  const punctuationPauses = (narration.match(/[.!?]/gu)?.length ?? 0) * 180
    + (narration.match(/[,;:]/gu)?.length ?? 0) * 70;
  return Math.max(800, Math.round(spokenMs + punctuationPauses / normalizedSpeed));
}

function resolveMention(
  mention: string,
  focusedText: string,
  focusStart: TextPosition,
): { pointerText: string; range: TextRange } | undefined {
  const candidates = mentionCandidates(mention);
  for (const candidate of candidates) {
    const match = findUniqueCandidate(focusedText, candidate);
    if (match === "ambiguous") {
      return undefined;
    }
    if (match === undefined) {
      continue;
    }
    return {
      pointerText: candidate,
      range: {
        start: offsetToPosition(focusedText, match, focusStart),
        end: offsetToPosition(focusedText, match + candidate.length, focusStart),
      },
    };
  }
  return undefined;
}

function mentionCandidates(mention: string): string[] {
  const normalized = mention.trim();
  if (looksLikeFileReference(normalized)) {
    return [normalized];
  }
  const identifiers = normalized.match(/[A-Za-z_$][A-Za-z0-9_$-]*/gu) ?? [];
  return [...new Set([normalized, ...identifiers.reverse().filter((identifier) => identifier.length > 1)])];
}

function looksLikeFileReference(value: string): boolean {
  return value.includes("/")
    || value.includes("\\")
    || /\.(?:c|cc|cpp|cs|css|go|h|hpp|html|java|js|json|jsx|md|php|py|rb|rs|scss|sh|sql|swift|toml|ts|tsx|vue|xml|ya?ml)(?::\d+)?$/iu.test(value);
}

function findUniqueCandidate(text: string, candidate: string): number | "ambiguous" | undefined {
  let uniqueOffset: number | undefined;
  let searchOffset = 0;
  while (searchOffset <= text.length - candidate.length) {
    const offset = text.indexOf(candidate, searchOffset);
    if (offset === -1) {
      break;
    }
    searchOffset = offset + Math.max(1, candidate.length);
    if (!hasIdentifierBoundaries(text, candidate, offset)) {
      continue;
    }
    if (uniqueOffset !== undefined) {
      return "ambiguous";
    }
    uniqueOffset = offset;
  }
  return uniqueOffset;
}

function hasIdentifierBoundaries(text: string, candidate: string, offset: number): boolean {
  if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/u.test(candidate)) {
    return true;
  }
  const identifierCharacter = /[A-Za-z0-9_$-]/u;
  const before = text[offset - 1];
  const after = text[offset + candidate.length];
  return (before === undefined || !identifierCharacter.test(before))
    && (after === undefined || !identifierCharacter.test(after));
}

function findCaseInsensitive(text: string, value: string, fromIndex: number): number {
  return text.toLowerCase().indexOf(value.toLowerCase(), fromIndex);
}

function offsetToPosition(text: string, offset: number, start: TextPosition): TextPosition {
  const preceding = text.slice(0, offset).split("\n");
  return {
    line: start.line + preceding.length - 1,
    character: preceding.length === 1
      ? start.character + (preceding[0]?.length ?? 0)
      : preceding.at(-1)?.length ?? 0,
  };
}
