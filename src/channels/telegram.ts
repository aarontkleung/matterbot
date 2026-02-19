import { Bot } from 'grammy';

import {
  ASSISTANT_NAME,
  TRIGGER_PATTERN,
} from '../config.js';
import { logger } from '../logger.js';
import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function markdownToTelegramV2(text: string): string {
  // Protect code blocks and inline code from escaping
  const protected_: string[] = [];
  const ph = (s: string) => { protected_.push(s); return `\x00${protected_.length - 1}\x00`; };

  let result = text
    // Remove horizontal rules early
    .replace(/^---+$/gm, '')
    // Protect fenced code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => ph(`\`\`\`${lang}\n${code}\`\`\``))
    // Protect inline code
    .replace(/`([^`]+)`/g, (_, code) => ph(`\`${code}\``));

  // Extract markdown constructs, escape their content, wrap in MarkdownV2 tags
  // Bold: **text** or __text__
  result = result
    .replace(/\*\*(.+?)\*\*/g, (_, c) => ph(`*${escapeMarkdownV2(c)}*`))
    .replace(/__(.+?)__/g, (_, c) => ph(`*${escapeMarkdownV2(c)}*`));
  // Headings → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, c) => ph(`*${escapeMarkdownV2(c)}*`));
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) =>
    ph(`[${escapeMarkdownV2(t)}](${u})`));

  // Escape everything else
  result = escapeMarkdownV2(result);

  // Restore protected sections
  for (let i = 0; i < protected_.length; i++) {
    result = result.replace(`\x00${i}\x00`, protected_[i]);
  }

  return result.replace(/\n{3,}/g, '\n\n');
}

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
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
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
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
      const numericId = jid.replace(/^tg:/, '');
      const formatted = markdownToTelegramV2(text);
      const MAX_LENGTH = 4096;
      const send = async (chunk: string) => {
        try {
          await this.bot!.api.sendMessage(numericId, chunk, { parse_mode: 'MarkdownV2' });
        } catch {
          // Fallback to plain text if MarkdownV2 parsing fails
          await this.bot!.api.sendMessage(numericId, text.length <= MAX_LENGTH ? text : chunk);
        }
      };
      if (formatted.length <= MAX_LENGTH) {
        await send(formatted);
      } else {
        for (let i = 0; i < formatted.length; i += MAX_LENGTH) {
          await send(formatted.slice(i, i + MAX_LENGTH));
        }
      }
      logger.info({ jid, length: text.length }, 'Telegram message sent');
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
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }

  async sendStatusMessage(jid: string, text: string): Promise<number | null> {
    if (!this.bot) return null;
    try {
      const numericId = jid.replace(/^tg:/, '');
      const msg = await this.bot.api.sendMessage(numericId, text);
      return msg.message_id;
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram status message');
      return null;
    }
  }

  async editMessage(jid: string, messageId: number, text: string): Promise<void> {
    if (!this.bot) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.editMessageText(numericId, messageId, text);
    } catch (err) {
      // Telegram returns 400 if text is unchanged — safe to ignore
      logger.debug({ jid, messageId, err }, 'Failed to edit Telegram message');
    }
  }

  async deleteMessage(jid: string, messageId: number): Promise<void> {
    if (!this.bot) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.deleteMessage(numericId, messageId);
    } catch (err) {
      logger.debug({ jid, messageId, err }, 'Failed to delete Telegram message');
    }
  }
}
