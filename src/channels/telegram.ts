import { Bot } from 'grammy';
import MarkdownIt from 'markdown-it';

import {
  ASSISTANT_NAME,
  TRIGGER_PATTERN,
} from '../config.js';
import { logger } from '../logger.js';
// convertMarkdownTables disabled - was causing HTML parse errors
// import { convertMarkdownTables } from '../router.js';
import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const md = new MarkdownIt({ html: false, linkify: false, breaks: false, typographer: false })
  .enable('strikethrough')
  .disable('table')
  .disable('image');

type Token = ReturnType<typeof md.parse>[number];

function renderTokens(tokens: Token[]): string {
  let out = '';

  for (const tok of tokens) {
    if (tok.children) {
      out += renderInline(tok.children);
      continue;
    }

    switch (tok.type) {
      case 'heading_open':
        out += '<b>';
        break;
      case 'heading_close':
        out += '</b>\n';
        break;
      case 'paragraph_open':
        break;
      case 'paragraph_close':
        out += '\n';
        break;
      case 'blockquote_open':
        out += '<blockquote>';
        break;
      case 'blockquote_close':
        if (out.endsWith('\n')) out = out.slice(0, -1);
        out += '</blockquote>\n';
        break;
      case 'list_item_open':
        out += '• ';
        break;
      case 'fence': {
        const lang = tok.info?.trim();
        const code = escapeHtml(tok.content.replace(/\n$/, ''));
        out += lang
          ? `<pre><code class="language-${lang}">${code}</code></pre>\n`
          : `<pre>${code}</pre>\n`;
        break;
      }
      case 'code_block': {
        const code = escapeHtml(tok.content.replace(/\n$/, ''));
        out += `<pre>${code}</pre>\n`;
        break;
      }
      case 'inline':
        out += renderInline(tok.children || []);
        break;
      default:
        break;
    }
  }

  // Merge consecutive blockquotes
  out = out.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  // Collapse excessive newlines
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function renderInline(tokens: Token[]): string {
  let out = '';
  for (const tok of tokens) {
    switch (tok.type) {
      case 'text':
        out += escapeHtml(tok.content);
        break;
      case 'softbreak':
      case 'hardbreak':
        out += '\n';
        break;
      case 'code_inline':
        out += `<code>${escapeHtml(tok.content)}</code>`;
        break;
      case 'strong_open':
        out += '<b>';
        break;
      case 'strong_close':
        out += '</b>';
        break;
      case 'em_open':
        out += '<i>';
        break;
      case 'em_close':
        out += '</i>';
        break;
      case 's_open':
        out += '<s>';
        break;
      case 's_close':
        out += '</s>';
        break;
      case 'link_open': {
        const href = tok.attrGet('href') || '';
        out += `<a href="${escapeAttr(href)}">`;
        break;
      }
      case 'link_close':
        out += '</a>';
        break;
      default:
        if (tok.content) out += escapeHtml(tok.content);
        break;
    }
  }
  return out;
}

function markdownToTelegramHtml(text: string): string {
  // convertMarkdownTables disabled - pass text directly to markdown-it
  const tokens = md.parse(text, {});
  return renderTokens(tokens);
}

const MAX_TG_LENGTH = 4096;

/** Split raw markdown into logical blocks that can be parsed independently. */
function splitMarkdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  const lines = text.split('\n');
  let current: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line.trimEnd())) {
      if (inFence) {
        current.push(line);
        blocks.push(current.join('\n'));
        current = [];
        inFence = false;
        continue;
      } else {
        if (current.length > 0) {
          blocks.push(current.join('\n'));
          current = [];
        }
        current.push(line);
        inFence = true;
        continue;
      }
    }

    if (inFence) {
      current.push(line);
      continue;
    }

    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }
  return blocks;
}

/** Accumulate markdown blocks into chunks whose HTML stays under the Telegram limit. */
function chunkMarkdownForTelegram(blocks: string[]): string[] {
  const chunks: string[] = [];
  let currentBlocks: string[] = [];
  let currentHtmlLen = 0;

  for (const block of blocks) {
    const blockHtml = markdownToTelegramHtml(block);

    if (blockHtml.length > MAX_TG_LENGTH) {
      if (currentBlocks.length > 0) {
        chunks.push(currentBlocks.join('\n\n'));
        currentBlocks = [];
        currentHtmlLen = 0;
      }
      chunks.push(block);
      continue;
    }

    const sep = currentBlocks.length > 0 ? 2 : 0;
    if (currentHtmlLen + sep + blockHtml.length > MAX_TG_LENGTH && currentBlocks.length > 0) {
      chunks.push(currentBlocks.join('\n\n'));
      currentBlocks = [block];
      currentHtmlLen = blockHtml.length;
    } else {
      currentBlocks.push(block);
      currentHtmlLen += sep + blockHtml.length;
    }
  }

  if (currentBlocks.length > 0) {
    chunks.push(currentBlocks.join('\n\n'));
  }
  return chunks;
}

/** Simple line-boundary splitter for plain text fallback. */
function splitPlainText(input: string, maxLength: number): string[] {
  const result: string[] = [];
  let current = '';
  for (const line of input.split('\n')) {
    if (current.length + line.length + 1 > maxLength && current) {
      result.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) result.push(current);
  return result;
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

      const sendHtml = async (html: string, plainFallback: string) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await this.bot!.api.sendMessage(chatId, html, { parse_mode: 'HTML' });
            return;
          } catch (err: unknown) {
            const ge = err as { error_code?: number; parameters?: { retry_after?: number } };
            if (ge.error_code === 429 && ge.parameters?.retry_after) {
              const delay = ge.parameters.retry_after * 1000 + 500;
              logger.debug({ delay, attempt }, 'Telegram rate limited, retrying');
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            // HTML parse error — fall back to plain text
            for (const pc of splitPlainText(plainFallback, MAX_TG_LENGTH)) {
              await this.bot!.api.sendMessage(chatId, pc);
            }
            return;
          }
        }
      };

      // Split markdown at block boundaries, then convert each chunk independently
      const mdChunks = chunkMarkdownForTelegram(splitMarkdownBlocks(text));

      for (let i = 0; i < mdChunks.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1000));
        const html = markdownToTelegramHtml(mdChunks[i]);

        if (html.length > MAX_TG_LENGTH) {
          // Oversized single block — send as plain text
          for (const pc of splitPlainText(mdChunks[i], MAX_TG_LENGTH)) {
            await this.bot!.api.sendMessage(chatId, pc);
          }
        } else {
          await sendHtml(html, mdChunks[i]);
        }
      }
      logger.info({ jid, length: text.length, chunks: mdChunks.length }, 'Telegram message sent');
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
