import * as vscode from "vscode";
import {
  type FocusContentInput,
  type PointAtContentInput,
  resolveFocus,
  resolvePointer,
  type TextRange,
} from "./model.js";

export class FocusController implements vscode.Disposable {
  private readonly focusDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
    borderColor: new vscode.ThemeColor("editor.findMatchBorder"),
    borderStyle: "solid",
    borderWidth: "1px 0",
    isWholeLine: true,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

  private readonly pointerDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    borderColor: new vscode.ThemeColor("editor.findMatchBorder"),
    borderStyle: "solid",
    borderWidth: "1px",
    fontWeight: "bold",
    overviewRulerColor: new vscode.ThemeColor("editor.findMatchBackground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    before: {
      color: new vscode.ThemeColor("editor.findMatchBorder"),
      contentText: "|",
      fontWeight: "bold",
      margin: "0 2px 0 0",
    },
  });

  private activeFocus: ActiveFocus | undefined;
  private readonly visibleEditorsSubscription: vscode.Disposable;
  private readonly documentChangeSubscription: vscode.Disposable;

  constructor() {
    this.visibleEditorsSubscription = vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        this.applyToEditor(editor);
      }
    });
    this.documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (this.activeFocus?.uri.toString() === event.document.uri.toString()) {
        this.clear();
      }
    });
  }

  async focus(input: FocusContentInput, token: vscode.CancellationToken): Promise<string> {
    throwIfCancelled(token);
    const uri = await resolveWorkspaceFile(input.path, token);
    const document = await vscode.workspace.openTextDocument(uri);
    throwIfCancelled(token);

    const resolved = resolveFocus(input, documentLines(document));
    const focus = toVsCodeRange(resolved.focus);
    const editor = await vscode.window.showTextDocument(document, { preview: false });

    this.clearDecorations();
    this.activeFocus = { uri: document.uri, focus };
    this.applyToVisibleEditors();
    editor.revealRange(focus, vscode.TextEditorRevealType.InCenter);

    return `Focused ${resolved.path}:${formatRange(focus)}.`;
  }

  async point(input: PointAtContentInput, token: vscode.CancellationToken): Promise<string> {
    const activeFocus = this.activeFocus;
    if (activeFocus === undefined) {
      throw new Error("No content is focused. Call focusContent before pointAtContent.");
    }
    if (input.action === "clear") {
      this.clearPointer();
      return "Cleared the precise pointer and preserved the focused section.";
    }

    throwIfCancelled(token);
    const document = await vscode.workspace.openTextDocument(activeFocus.uri);
    throwIfCancelled(token);
    const pointer = resolvePointer(input, fromVsCodeRange(activeFocus.focus), documentLines(document));
    if (pointer === undefined) {
      throw new Error("A point request unexpectedly resolved to clear.");
    }

    const pointerRange = toVsCodeRange(pointer);
    this.activeFocus = { ...activeFocus, pointer: pointerRange };
    this.applyToVisibleEditors();
    return `Pointed to ${formatRange(pointerRange)} without changing or scrolling the focused section.`;
  }

  focusAroundCursor(): void {
    const editor = requireActiveEditor();
    const line = editor.selection.active.line;
    const startLine = Math.max(0, line - 4);
    const endLine = Math.min(editor.document.lineCount - 1, line + 4);
    const focus = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);

    this.clearDecorations();
    this.activeFocus = { uri: editor.document.uri, focus };
    this.applyToVisibleEditors();
    editor.revealRange(focus, vscode.TextEditorRevealType.InCenter);
  }

  pointAtCursor(): void {
    const editor = requireActiveEditor();
    const activeFocus = this.activeFocus;
    if (activeFocus === undefined || activeFocus.uri.toString() !== editor.document.uri.toString()) {
      throw new Error("Focus a section in the active editor before pointing at the cursor.");
    }

    const pointer = wordOrCursorRange(editor.document, editor.selection.active);
    if (!activeFocus.focus.contains(pointer)) {
      throw new Error("Move the cursor inside the focused section before pointing at it.");
    }

    this.activeFocus = { ...activeFocus, pointer };
    this.applyToVisibleEditors();
  }

  demoAtCursor(): void {
    this.focusAroundCursor();
    this.pointAtCursor();
  }

  clearPointer(): void {
    if (this.activeFocus === undefined) {
      return;
    }
    this.activeFocus = {
      uri: this.activeFocus.uri,
      focus: this.activeFocus.focus,
    };
    this.applyToVisibleEditors();
  }

  clear(): void {
    this.clearDecorations();
    this.activeFocus = undefined;
  }

  dispose(): void {
    this.visibleEditorsSubscription.dispose();
    this.documentChangeSubscription.dispose();
    this.focusDecoration.dispose();
    this.pointerDecoration.dispose();
  }

  private applyToVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyToEditor(editor);
    }
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    if (this.activeFocus !== undefined && editor.document.uri.toString() === this.activeFocus.uri.toString()) {
      editor.setDecorations(this.focusDecoration, [this.activeFocus.focus]);
      editor.setDecorations(this.pointerDecoration, this.activeFocus.pointer === undefined ? [] : [this.activeFocus.pointer]);
    } else {
      editor.setDecorations(this.focusDecoration, []);
      editor.setDecorations(this.pointerDecoration, []);
    }
  }

  private clearDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.focusDecoration, []);
      editor.setDecorations(this.pointerDecoration, []);
    }
  }
}

interface ActiveFocus {
  uri: vscode.Uri;
  focus: vscode.Range;
  pointer?: vscode.Range;
}

async function resolveWorkspaceFile(
  rawPath: string | undefined,
  token: vscode.CancellationToken,
): Promise<vscode.Uri> {
  const normalizedPath = normalizeWorkspacePath(rawPath);
  const folders = vscode.workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    throw new Error("Open a workspace before focusing content.");
  }

  const explicitlyNamedFolder = folders.find((folder) => normalizedPath.startsWith(`${folder.name}/`));
  const candidateFolders = explicitlyNamedFolder === undefined ? folders : [explicitlyNamedFolder];
  const matches: vscode.Uri[] = [];
  for (const folder of candidateFolders) {
    throwIfCancelled(token);
    const folderPrefix = `${folder.name}/`;
    const relativePath = normalizedPath.startsWith(folderPrefix)
      ? normalizedPath.slice(folderPrefix.length)
      : normalizedPath;
    const uri = vscode.Uri.joinPath(folder.uri, ...relativePath.split("/"));
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.File) !== 0) {
        matches.push(uri);
      }
    } catch (error: unknown) {
      if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) {
        throw error;
      }
    }
  }

  const uniqueMatches = [...new Map(matches.map((uri) => [uri.toString(), uri])).values()];
  if (uniqueMatches.length === 0) {
    throw new Error(`No workspace file exists at '${normalizedPath}'.`);
  }
  if (uniqueMatches.length > 1) {
    throw new Error(`'${normalizedPath}' exists in multiple workspace folders; prefix it with the workspace folder name.`);
  }
  const match = uniqueMatches[0];
  if (match === undefined) {
    throw new Error(`No workspace file exists at '${normalizedPath}'.`);
  }
  return match;
}

function normalizeWorkspacePath(rawPath: string | undefined): string {
  if (rawPath === undefined || rawPath.trim().length === 0) {
    throw new Error("path is required.");
  }
  const normalized = rawPath.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/")
    || segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)
  ) {
    throw new Error("path must be a normalized workspace-relative file path and cannot contain '..'.");
  }
  return normalized;
}

function documentLines(document: vscode.TextDocument): string[] {
  return Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text);
}

function toVsCodeRange(range: TextRange): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

function fromVsCodeRange(range: vscode.Range): TextRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function requireActiveEditor(): vscode.TextEditor {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    throw new Error("Open a text editor before using Maieutic commands.");
  }
  return editor;
}

function wordOrCursorRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  const word = document.getWordRangeAtPosition(position);
  if (word !== undefined) {
    return word;
  }
  const lineLength = document.lineAt(position.line).text.length;
  const end = Math.min(position.character + 1, lineLength);
  return new vscode.Range(position, new vscode.Position(position.line, end));
}

function formatRange(range: vscode.Range): string {
  const startLine = range.start.line + 1;
  const endLine = range.end.line + 1;
  return startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}
