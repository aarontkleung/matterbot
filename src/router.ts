import { Channel, NewMessage } from './types.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map((m) =>
    `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`,
  );
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

/** Convert markdown tables to aligned code blocks for chat platforms. */
export function convertMarkdownTables(text: string): string {
  return text.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n');
    const parsed = rows
      .filter(row => !/^\|[\s\-:|]+\|$/.test(row))
      .map(row =>
        row.split('|').slice(1, -1).map(cell => cell.trim()),
      );
    if (parsed.length === 0) return tableBlock;

    const colCount = Math.max(...parsed.map(r => r.length));
    const widths = Array(colCount).fill(0) as number[];
    for (const row of parsed) {
      for (let i = 0; i < row.length; i++) {
        widths[i] = Math.max(widths[i], row[i].length);
      }
    }

    const formatted = parsed
      .map(row => row.map((cell, i) => cell.padEnd(widths[i])).join('  '))
      .join('\n');
    return '```\n' + formatted + '\n```';
  });
}

export function formatOutbound(rawText: string): string {
  return stripInternalTags(rawText);
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
