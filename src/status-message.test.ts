import { describe, expect, it, vi } from 'vitest';

import {
  createStatusState,
  handleStatusMessage,
  handleToolUse,
} from './status-message.js';
import { Channel } from './types.js';

function makeTelegramChannel() {
  const sendStatusMessage = vi.fn<NonNullable<Channel['sendStatusMessage']>>(
    async () => 42,
  );
  const editMessage = vi.fn<NonNullable<Channel['editMessage']>>(async () => {
    // noop
  });

  const channel: Channel = {
    name: 'telegram',
    connect: async () => {},
    sendMessage: async () => {},
    isConnected: () => true,
    ownsJid: () => true,
    disconnect: async () => {},
    sendStatusMessage,
    editMessage,
  };

  return { channel, sendStatusMessage, editMessage };
}

function forceImmediateEdit(state: { lastEditTime: number }): void {
  state.lastEditTime = Date.now() - 2000;
}

describe('status message formatting', () => {
  it('inserts one blank line between status comment and tool lines', async () => {
    const { channel, sendStatusMessage, editMessage } = makeTelegramChannel();
    const state = createStatusState();

    await handleStatusMessage(channel, 'tg:1', state, 'Checking files');
    expect(sendStatusMessage).toHaveBeenCalledWith('tg:1', 'Checking files');

    forceImmediateEdit(state);
    await handleToolUse(channel, 'tg:1', state, 'Read', 'config.ts');

    expect(editMessage).toHaveBeenLastCalledWith(
      'tg:1',
      42,
      'Checking files\n\n○ Reading file: config.ts',
    );
  });

  it('keeps comment-only status text unchanged', async () => {
    const { channel, sendStatusMessage, editMessage } = makeTelegramChannel();
    const state = createStatusState();

    await handleStatusMessage(channel, 'tg:1', state, 'Analyzing');

    expect(sendStatusMessage).toHaveBeenCalledWith('tg:1', 'Analyzing');
    expect(editMessage).not.toHaveBeenCalled();
  });

  it('keeps tools-only status text unchanged', async () => {
    const { channel, sendStatusMessage } = makeTelegramChannel();
    const state = createStatusState();

    await handleToolUse(channel, 'tg:1', state, 'Read', 'README.md');

    expect(sendStatusMessage).toHaveBeenCalledWith(
      'tg:1',
      '○ Reading file: README.md',
    );
  });

  it('applies a single section separator with completed and current tools', async () => {
    const { channel, editMessage } = makeTelegramChannel();
    const state = createStatusState();

    await handleStatusMessage(channel, 'tg:1', state, 'Working...');
    forceImmediateEdit(state);
    await handleToolUse(channel, 'tg:1', state, 'Read', 'a.ts');
    forceImmediateEdit(state);
    await handleToolUse(channel, 'tg:1', state, 'Write', 'b.ts');

    const finalText = editMessage.mock.calls.at(-1)?.[2];
    expect(finalText).toBe('Working...\n\n● Reading file: a.ts\n○ Writing file: b.ts');
    expect(finalText).not.toContain('\n\n\n');
  });
});
