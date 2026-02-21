import { Bot } from 'grammy';

import {
  ASSISTANT_NAME,
  TRIGGER_PATTERN,
} from '../config.js';
import { logger } from '../logger.js';
import { convertMarkdownTables } from '../router.js';
import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markdownToTelegramHtml(text: string): string {
  const tableConverted = convertMarkdownTables(text);

  const protected_: string[] = [];
  const ph = (s: string) => { protected_.push(s); return `\x00${protected_.length - 1}\x00`; };

  let result = tableConverted
    .replace(/^---+$/gm, '')
    .replace(/^\d+\.\s+/gm, '• ')
    .replace(/^[-*]\s+/gm, '• ')
    // Fenced code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      lang
        ? ph(`<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`)
        : ph(`<pre>${escapeHtml(code)}</pre>`))
    // Inline code
    .replace(/`([^`]+)`/g, (_, code) => ph(`<code>${escapeHtml(code)}</code>`));

  // Bold+italic
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, (_, c) =>
    ph(`<b><i>${escapeHtml(c)}</i></b>`));
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, (_, c) =>
    ph(`<b>${escapeHtml(c)}</b>`));
  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, (_, c) =>
    ph(`<s>${escapeHtml(c)}</s>`));
  // Italic
  result = result.replace(/\*(.+?)\*/g, (_, c) =>
    ph(`<i>${escapeHtml(c)}</i>`));
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, (_, c) =>
    ph(`<i>${escapeHtml(c)}</i>`));
  // Headings → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, c) =>
    ph(`<b>${escapeHtml(c)}</b>`));
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) =>
    ph(`<a href="${u.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${escapeHtml(t)}</a>`));
  // Blockquotes
  result = result.replace(/^>\s?(.*)$/gm, (_, c) =>
    ph(`<blockquote>${escapeHtml(c)}</blockquote>`));

  result = escapeHtml(result);

  for (let i = 0; i < protected_.length; i++) {
    result = result.replace(`\x00${i}\x00`, protected_[i]);
  }

  // Merge consecutive blockquotes into one
  result = result.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  return result.replace(/\n{3,}/g, '\n\n');
}

function numericId(jid: string): string {
  return jid.replace(/^tg:/, '');
}

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  onClear: (chatJid: string) => Promise<string>;
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken);

    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown';

      ctx.reply(
        `Chat ID: <code>tg:${chatId}</code>\nName: ${escapeHtml(chatName)}\nType: ${chatType}`,
        { parse_mode: 'HTML' },
      );
    });

    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    this.bot.command('reset', async (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      try {
        const result = await this.opts.onClear(chatJid);
        await ctx.reply(result);
      } catch (err) {
        logger.error({ chatJid, err }, 'Failed to handle /reset');
        await ctx.reply('Failed to clear session.').catch(() => {});
      }
    });

    this.bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();

      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug({ chatJid, chatName }, 'Message from unregistered Telegram chat');
        return;
      }

      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info({ chatJid, chatName, sender: senderName }, 'Telegram message stored');
    });

    // Handle non-text messages with placeholders
    const storeNonText = (ctx: any, placeholder: string) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name || ctx.from?.username || ctx.from?.id?.toString() || 'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      this.opts.onChatMetadata(chatJid, timestamp);
      this.opts.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: `${placeholder}${caption}`,
        timestamp,
        is_from_me: false,
      });
    };

    this.bot.on('message:photo', (ctx) => storeNonText(ctx, '[Photo]'));
    this.bot.on('message:video', (ctx) => storeNonText(ctx, '[Video]'));
    this.bot.on('message:voice', (ctx) => storeNonText(ctx, '[Voice message]'));
    this.bot.on('message:audio', (ctx) => storeNonText(ctx, '[Audio]'));
    this.bot.on('message:document', (ctx) => {
      const name = ctx.message.document?.file_name || 'file';
      storeNonText(ctx, `[Document: ${name}]`);
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram bot: @${botInfo.username}`);
          console.log(`  Send /chatid to the bot to get a chat's registration ID\n`);
          resolve();
        },
      });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    try {
      const chatId = numericId(jid);
      const formatted = markdownToTelegramHtml(text);
      const MAX_LENGTH = 4096;

      const send = async (chunk: string, plainChunk: string) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await this.bot!.api.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
            return;
          } catch (err: unknown) {
            const ge = err as { error_code?: number; parameters?: { retry_after?: number } };
            if (ge.error_code === 429 && ge.parameters?.retry_after) {
              const delay = ge.parameters.retry_after * 1000 + 500;
              logger.debug({ delay, attempt }, 'Telegram rate limited, retrying');
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            // HTML parse error — fall back to plain text chunk
            await this.bot!.api.sendMessage(chatId, plainChunk);
            return;
          }
        }
      };

      // Split both formatted and plain text at newline boundaries
      const splitLines = (input: string) => {
        const result: string[] = [];
        let current = '';
        for (const line of input.split('\n')) {
          if (current.length + line.length + 1 > MAX_LENGTH && current) {
            result.push(current);
            current = line;
          } else {
            current += (current ? '\n' : '') + line;
          }
        }
        if (current) result.push(current);
        return result;
      };

      const chunks = splitLines(formatted);
      const plainChunks = splitLines(text);

      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1000));
        await send(chunks[i], plainChunks[i] || chunks[i]);
      }
      logger.info({ jid, length: text.length, chunks: chunks.length }, 'Telegram message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      await this.bot.api.sendChatAction(numericId(jid), 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }

  async sendStatusMessage(jid: string, text: string): Promise<number | null> {
    if (!this.bot) return null;
    try {
      const msg = await this.bot.api.sendMessage(numericId(jid), text);
      return msg.message_id;
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram status message');
      return null;
    }
  }

  async editMessage(jid: string, messageId: number, text: string): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.editMessageText(numericId(jid), messageId, text);
    } catch (err) {
      // Telegram returns 400 if text is unchanged — safe to ignore
      logger.debug({ jid, messageId, err }, 'Failed to edit Telegram message');
    }
  }

  async deleteMessage(jid: string, messageId: number): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.deleteMessage(numericId(jid), messageId);
    } catch (err) {
      logger.debug({ jid, messageId, err }, 'Failed to delete Telegram message');
    }
  }
}
