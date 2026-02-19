/**
 * Status message lifecycle for Telegram edit-in-place tool indicators.
 * Shows what tool the agent is currently using, then deletes the message
 * when the final response arrives.
 */
import { Channel } from './types.js';
import { logger } from './logger.js';

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Read: 'Reading file',
  Write: 'Writing file',
  Edit: 'Editing file',
  Bash: 'Running command',
  Grep: 'Searching code',
  Glob: 'Finding files',
  WebSearch: 'Searching the web',
  WebFetch: 'Fetching page',
  Task: 'Running subtask',
  TaskOutput: 'Checking task output',
  TeamCreate: 'Creating subagent',
  SendMessage: 'Messaging subagent',
  Skill: 'Running skill',
  NotebookEdit: 'Editing notebook',
};

/** Minimum interval between Telegram edits (ms) to respect rate limits */
const MIN_EDIT_INTERVAL = 1500;

export interface StatusState {
  messageId: number | null;
  lastEditTime: number;
  pendingText: string | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export function createStatusState(): StatusState {
  return { messageId: null, lastEditTime: 0, pendingText: null, debounceTimer: null };
}

function formatStatusText(toolName: string, summary?: string): string {
  const display = TOOL_DISPLAY_NAMES[toolName] || `Using ${toolName}`;
  return summary ? `⏳ ${display}: ${summary}` : `⏳ ${display}`;
}

export async function handleToolUse(
  channel: Channel,
  jid: string,
  state: StatusState,
  toolName: string,
  summary?: string,
): Promise<void> {
  // Only works for channels that support status messages
  if (!channel.sendStatusMessage || !channel.editMessage) return;

  const text = formatStatusText(toolName, summary);

  if (state.messageId === null) {
    // First tool use — send a new status message
    state.messageId = await channel.sendStatusMessage(jid, text);
    state.lastEditTime = Date.now();
    return;
  }

  // Subsequent tool uses — debounced edit
  const now = Date.now();
  const elapsed = now - state.lastEditTime;

  if (elapsed >= MIN_EDIT_INTERVAL) {
    // Enough time has passed, edit immediately
    await channel.editMessage(jid, state.messageId, text);
    state.lastEditTime = Date.now();
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
  } else {
    // Too soon — schedule a debounced edit
    state.pendingText = text;
    if (!state.debounceTimer) {
      state.debounceTimer = setTimeout(async () => {
        state.debounceTimer = null;
        if (state.pendingText && state.messageId && channel.editMessage) {
          await channel.editMessage(jid, state.messageId, state.pendingText);
          state.lastEditTime = Date.now();
          state.pendingText = null;
        }
      }, MIN_EDIT_INTERVAL - elapsed);
    }
  }
}

export async function cleanupStatusMessage(
  channel: Channel,
  jid: string,
  state: StatusState,
): Promise<void> {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  if (state.messageId !== null && channel.deleteMessage) {
    try {
      await channel.deleteMessage(jid, state.messageId);
    } catch (err) {
      logger.debug({ jid, messageId: state.messageId, err }, 'Failed to delete status message');
    }
    state.messageId = null;
  }
}
