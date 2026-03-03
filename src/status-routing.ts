import { formatOutbound } from './router.js';
import { Channel } from './types.js';

export interface PersistentStatusBlockState {
  messageId: number | null;
  comments: string[];
  lastDeliveredCommentCount: number;
  lastDeliveredBlockText: string;
}

export interface StatusBlockUpdateResult {
  sentOrEdited: boolean;
}

export function createPersistentStatusBlockState(): PersistentStatusBlockState {
  return {
    messageId: null,
    comments: [],
    lastDeliveredCommentCount: 0,
    lastDeliveredBlockText: '',
  };
}

/**
 * Append a status comment to a single persistent Telegram block.
 * The block is created once and then edited in place.
 */
export async function appendStatusCommentToPersistentBlock(
  channel: Channel | undefined,
  jid: string,
  state: PersistentStatusBlockState,
  rawStatusMessage: string,
): Promise<StatusBlockUpdateResult> {
  if (!channel || channel.name !== 'telegram') return { sentOrEdited: false };
  if (!channel.sendStatusMessage || (!channel.editMessage && !channel.editMessageWithResult)) {
    return { sentOrEdited: false };
  }

  const formatted = formatOutbound(rawStatusMessage).trim();
  if (!formatted) return { sentOrEdited: false };

  // Skip repeated identical updates from streaming jitter.
  if (state.comments.length > 0 && state.comments[state.comments.length - 1] === formatted) {
    return { sentOrEdited: false };
  }

  state.comments.push(formatted);
  const blockText = state.comments.join('\n\n');

  if (state.messageId === null) {
    const messageId = await channel.sendStatusMessage(jid, blockText);
    if (messageId !== null) {
      state.messageId = messageId;
      state.lastDeliveredCommentCount = state.comments.length;
      state.lastDeliveredBlockText = blockText;
      return { sentOrEdited: true };
    }
    return { sentOrEdited: false };
  }

  const editSucceeded = channel.editMessageWithResult
    ? await channel.editMessageWithResult(jid, state.messageId, blockText)
    : (await channel.editMessage!(jid, state.messageId, blockText), true);

  if (editSucceeded) {
    state.lastDeliveredCommentCount = state.comments.length;
    state.lastDeliveredBlockText = blockText;
    return { sentOrEdited: true };
  }

  // Message might have been deleted; recreate on next update.
  state.messageId = null;
  return { sentOrEdited: false };
}

export function shouldSuppressFinalResult(
  channel: Channel | undefined,
  state: PersistentStatusBlockState,
  formattedFinalResult: string,
): boolean {
  if (channel?.name !== 'telegram') return false;

  const finalText = formattedFinalResult.trim();
  if (!finalText) return false;
  if (!state.lastDeliveredBlockText.trim()) return false;

  const deliveredComments = state.comments
    .slice(0, state.lastDeliveredCommentCount)
    .map((s) => s.trim())
    .filter(Boolean);
  if (deliveredComments.length === 0) return false;

  const lastComment = deliveredComments[deliveredComments.length - 1];
  if (finalText === lastComment) return true;

  const deliveredBlock = state.lastDeliveredBlockText.trim();
  if (finalText === deliveredBlock) return true;

  return deliveredBlock.endsWith(`\n\n${finalText}`) || deliveredBlock.endsWith(`\n${finalText}`);
}
