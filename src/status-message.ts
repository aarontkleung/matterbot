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

interface ToolEntry { display: string; summary?: string }

export interface StatusState {
  messageId: number | null;
  lastEditTime: number;
  pendingText: string | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  completedTools: ToolEntry[];
  currentTool: ToolEntry | null;
  thinkingText: string | null;
}

export function createStatusState(): StatusState {
  return {
    messageId: null,
    lastEditTime: 0,
    pendingText: null,
    debounceTimer: null,
    completedTools: [],
    currentTool: null,
    thinkingText: null,
  };
}

function toolDisplayLine(toolEntry: ToolEntry, prefix: string): string {
  const suffix = toolEntry.summary ? `: ${toolEntry.summary}` : '';
  return `${prefix} ${toolEntry.display}${suffix}`;
}

function formatStatusText(state: StatusState): string {
  const lines: string[] = [];

  if (state.thinkingText) {
    lines.push(state.thinkingText);
  }

  const completed = state.completedTools;
  const maxShown = 4;

  if (completed.length > maxShown) {
    lines.push(`... and ${completed.length - maxShown} more`);
  }
  for (const entry of completed.slice(-maxShown)) {
    lines.push(toolDisplayLine(entry, '●'));
  }
  if (state.currentTool) {
    lines.push(toolDisplayLine(state.currentTool, '○'));
  }
  return lines.join('\n');
}

async function sendOrEditStatus(
  channel: Channel,
  jid: string,
  state: StatusState,
): Promise<void> {
  if (!channel.sendStatusMessage || !channel.editMessage) return;

  const text = formatStatusText(state);

  if (state.messageId === null) {
    state.messageId = await channel.sendStatusMessage(jid, text);
    state.lastEditTime = Date.now();
    return;
  }

  const now = Date.now();
  const elapsed = now - state.lastEditTime;

  if (elapsed >= MIN_EDIT_INTERVAL) {
    await channel.editMessage(jid, state.messageId, text);
    state.lastEditTime = Date.now();
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
  } else {
    state.pendingText = text;
    if (!state.debounceTimer) {
      const delay = MIN_EDIT_INTERVAL - elapsed;
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        if (state.pendingText && state.messageId && channel.editMessage) {
          channel.editMessage(jid, state.messageId, state.pendingText)
            .then(() => {
              state.lastEditTime = Date.now();
              state.pendingText = null;
            })
            .catch((err) => logger.debug({ err }, 'Debounced status edit failed'));
        }
      }, delay);
    }
  }
}

export async function handleToolUse(
  channel: Channel,
  jid: string,
  state: StatusState,
  toolName: string,
  summary?: string,
): Promise<void> {
  if (!channel.sendStatusMessage || !channel.editMessage) return;

  if (state.currentTool) {
    state.completedTools.push(state.currentTool);
  }
  const display = TOOL_DISPLAY_NAMES[toolName] ?? `Using ${toolName}`;
  state.currentTool = { display, summary };

  await sendOrEditStatus(channel, jid, state);
}

export async function handleThinking(
  channel: Channel,
  jid: string,
  state: StatusState,
  text: string,
): Promise<void> {
  if (!channel.sendStatusMessage || !channel.editMessage) return;

  // Static indicator — raw thinking text is too noisy
  state.thinkingText = 'Thinking…';

  await sendOrEditStatus(channel, jid, state);
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
  state.completedTools = [];
  state.currentTool = null;
  state.thinkingText = null;
}
