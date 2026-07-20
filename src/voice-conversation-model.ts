export const SOCRAITES_CHAT_PREFIX = "@socraites ";

export type ChatCommandExecutor = (command: string, ...args: unknown[]) => Promise<unknown>;

export async function openNewSocrAItesChat(executeCommand: ChatCommandExecutor): Promise<void> {
  await executeCommand("workbench.action.chat.cancel");
  await executeCommand("workbench.action.chat.open");
  await executeCommand("workbench.action.chat.newChat");
  await executeCommand("workbench.action.chat.open", {
    query: SOCRAITES_CHAT_PREFIX,
    isPartialQuery: true,
  });
}

export async function submitSocrAItesTranscript(
  executeCommand: ChatCommandExecutor,
  transcript: string,
): Promise<void> {
  await executeCommand("workbench.action.chat.open", {
    query: `${SOCRAITES_CHAT_PREFIX}${transcript}`,
    isPartialQuery: false,
  });
}
