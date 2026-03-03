import { describe, expect, it, vi } from 'vitest';

import {
  appendStatusCommentToPersistentBlock,
  createPersistentStatusBlockState,
  shouldSuppressFinalResult,
} from './status-routing.js';
import { Channel } from './types.js';

function makeTelegramChannel(
  opts: {
    sendStatusMessage?: Channel['sendStatusMessage'];
    editMessage?: Channel['editMessage'];
    editMessageWithResult?: Channel['editMessageWithResult'];
  } = {},
): Channel {
  return {
    name: 'telegram',
    connect: async () => {},
    sendMessage: vi.fn<Channel['sendMessage']>(async () => {}),
    sendMessageWithResult: vi.fn<NonNullable<Channel['sendMessageWithResult']>>(async () => true),
    isConnected: () => true,
    ownsJid: () => true,
    disconnect: async () => {},
    sendStatusMessage: opts.sendStatusMessage || vi.fn<NonNullable<Channel['sendStatusMessage']>>(async () => 42),
    editMessage: opts.editMessage || vi.fn<NonNullable<Channel['editMessage']>>(async () => {}),
    editMessageWithResult: opts.editMessageWithResult,
  };
}

describe('status routing', () => {
  it('creates then edits a single Telegram status block with blank-line separators', async () => {
    const sendStatusMessage = vi.fn<NonNullable<Channel['sendStatusMessage']>>(async () => 777);
    const editMessageWithResult = vi.fn<NonNullable<Channel['editMessageWithResult']>>(async () => true);
    const channel = makeTelegramChannel({ sendStatusMessage, editMessageWithResult });
    const state = createPersistentStatusBlockState();

    const first = await appendStatusCommentToPersistentBlock(
      channel,
      'tg:123',
      state,
      'Checking files',
    );
    const second = await appendStatusCommentToPersistentBlock(
      channel,
      'tg:123',
      state,
      'Applying fix',
    );

    expect(first.sentOrEdited).toBe(true);
    expect(second.sentOrEdited).toBe(true);
    expect(sendStatusMessage).toHaveBeenCalledTimes(1);
    expect(editMessageWithResult).toHaveBeenCalledTimes(1);
    expect(editMessageWithResult).toHaveBeenCalledWith(
      'tg:123',
      777,
      'Checking files\n\nApplying fix',
    );
    expect(state.messageId).toBe(777);
    expect(state.lastDeliveredBlockText).toBe('Checking files\n\nApplying fix');
  });

  it('ignores non-Telegram channels', async () => {
    const channel: Channel = {
      name: 'whatsapp',
      connect: async () => {},
      sendMessage: vi.fn<Channel['sendMessage']>(async () => {}),
      isConnected: () => true,
      ownsJid: () => true,
      disconnect: async () => {},
    };
    const state = createPersistentStatusBlockState();

    const result = await appendStatusCommentToPersistentBlock(
      channel,
      '1203@g.us',
      state,
      'Checking files',
    );

    expect(result.sentOrEdited).toBe(false);
    expect(state.comments).toEqual([]);
  });

  it('does not suppress final when delivered block differs', () => {
    const channel = makeTelegramChannel();
    const state = createPersistentStatusBlockState();
    state.comments = ['Checking files', 'Applying fix'];
    state.lastDeliveredCommentCount = 2;
    state.lastDeliveredBlockText = 'Checking files\n\nApplying fix';

    expect(shouldSuppressFinalResult(channel, state, 'All done with extra detail')).toBe(false);
  });

  it('suppresses final when it matches the last delivered status comment', () => {
    const channel = makeTelegramChannel();
    const state = createPersistentStatusBlockState();
    state.comments = ['Checking files', 'Final answer'];
    state.lastDeliveredCommentCount = 2;
    state.lastDeliveredBlockText = 'Checking files\n\nFinal answer';

    expect(shouldSuppressFinalResult(channel, state, 'Final answer')).toBe(true);
  });

  it('suppresses final when it is a suffix of the delivered status block', () => {
    const channel = makeTelegramChannel();
    const state = createPersistentStatusBlockState();
    state.comments = ['Progress', 'Answer line 1\nAnswer line 2'];
    state.lastDeliveredCommentCount = 2;
    state.lastDeliveredBlockText = 'Progress\n\nAnswer line 1\nAnswer line 2';

    expect(shouldSuppressFinalResult(channel, state, 'Answer line 1\nAnswer line 2')).toBe(true);
  });

  it('resets messageId when edit fails so next update can recreate', async () => {
    const sendStatusMessage = vi
      .fn<NonNullable<Channel['sendStatusMessage']>>()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(101);
    const editMessageWithResult = vi.fn<NonNullable<Channel['editMessageWithResult']>>(async () => false);
    const channel = makeTelegramChannel({ sendStatusMessage, editMessageWithResult });
    const state = createPersistentStatusBlockState();

    await appendStatusCommentToPersistentBlock(channel, 'tg:123', state, 'First');
    const second = await appendStatusCommentToPersistentBlock(channel, 'tg:123', state, 'Second');
    const third = await appendStatusCommentToPersistentBlock(channel, 'tg:123', state, 'Third');

    expect(second.sentOrEdited).toBe(false);
    expect(third.sentOrEdited).toBe(true);
    expect(sendStatusMessage).toHaveBeenCalledTimes(2);
    expect(state.messageId).toBe(101);
    expect(state.lastDeliveredBlockText).toBe('First\n\nSecond\n\nThird');
  });
});
