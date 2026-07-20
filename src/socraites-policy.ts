export interface ToolDescriptor {
  readonly name: string;
  readonly tags: readonly string[];
}

export const MAX_TEACHING_STEP_WORDS = 100;

const READ_ONLY_DISCOVERY_TOOLS = new Set([
  "copilot_fetchWebPage",
  "copilot_findFiles",
  "copilot_findTestFiles",
  "copilot_findTextInFiles",
  "copilot_getChangedFiles",
  "copilot_getErrors",
  "copilot_getVSCodeAPI",
  "copilot_githubRepo",
  "copilot_githubTextSearch",
  "copilot_listDirectory",
  "copilot_readFile",
  "copilot_readProjectStructure",
  "copilot_searchCodebase",
  "copilot_searchWorkspaceSymbols",
  "get_terminal_output",
  "search_subagent",
  "terminal_last_command",
  "terminal_selection",
  "vscode_listCodeUsages",
]);

export function selectReadOnlyDiscoveryTools<T extends ToolDescriptor>(tools: readonly T[]): T[] {
  return tools.filter((tool) => READ_ONLY_DISCOVERY_TOOLS.has(tool.name));
}

export function shouldPresentContent(prompt: string, hasWorkspace: boolean): boolean {
  if (!hasWorkspace) {
    return false;
  }

  const normalized = prompt.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return !/(?:^|\b)(?:hold|text[ -]?only|no visuals?|do not (?:focus|move|navigate)|don't (?:focus|move|navigate)|without (?:changing|moving) (?:the )?(?:current )?visual(?: state)?)(?:\b|$)/i.test(normalized);
}

export function hasRequiredVisualIntent(prompt: string): boolean {
  return /\b(?:continue|focus|lead|navigate|next|point|show|step by step|teach|tour|trace|walk(?:through)?)\b|\bthis (?:block|code|file|function|line|module|symbol)\b|\bwhere (?:does|is)\b/i.test(prompt);
}

export function isClearRequest(prompt: string): boolean {
  return /^(?:clear|clear (?:focus|presentation|visuals?))\.?$/i.test(prompt.trim());
}

export function stripAgentFrontmatter(source: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(source);
  return (match?.[1] ?? source).trim();
}

export function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+\.)\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4096);
}

export function isAcceptableTeachingStep(markdown: string): boolean {
  const words = markdown.trim().split(/\s+/).filter(Boolean);
  const questions = markdown.match(/\?/g)?.length ?? 0;
  const numberedItems = markdown.match(/^\s*\d+[.)]\s+/gm)?.length ?? 0;
  return words.length > 0
    && words.length <= MAX_TEACHING_STEP_WORDS
    && questions === 1
    && numberedItems === 0
    && !/\b(?:end-to-end flow|here are the steps|later steps?|next (?:file|handoff|stop))\b/i.test(markdown);
}
