import type { ChatMessage } from '../types';

export interface ShareCardMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ShareCardModel {
  title: string;
  date: string;
  messages: ShareCardMessage[];
  /** Total visible messages before capping. */
  totalCount: number;
  /** True when the card only contains the first MAX_SHARE_CARD_MESSAGES messages. */
  truncated: boolean;
}

/** Cap the card height so the capture bitmap stays bounded on low-end devices. */
export const MAX_SHARE_CARD_MESSAGES = 50;
/** Cap a single message so one huge reply cannot blow up the card. */
export const MAX_SHARE_CARD_MESSAGE_CHARS = 800;
const MAX_TITLE_CHARS = 30;
const FALLBACK_TITLE = '对话分享';

const isShareableMessage = (message: ChatMessage): message is ChatMessage & {
  role: 'user' | 'assistant';
} => message.role === 'user' || message.role === 'assistant';

const resolveMessageContent = (message: ChatMessage): string => {
  const direct = message.content.trim();
  if (direct) return direct;

  return (message.parts ?? [])
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter((part) => part.length > 0)
    .join('\n')
    .trim();
};

const truncateCodePoints = (value: string, max: number): string => {
  const characters = Array.from(value);
  if (characters.length <= max) return value;
  return `${characters.slice(0, Math.max(0, max - 1)).join('')}…`;
};

const truncateText = (value: string, max: number): string => {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return truncateCodePoints(normalized, max);
};

const formatDate = (now: Date): string => {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
};

const deriveTitle = (title: string | undefined, messages: ShareCardMessage[]): string => {
  const explicit = title?.trim();
  if (explicit) return truncateText(explicit, MAX_TITLE_CHARS);
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (firstUserMessage) return truncateText(firstUserMessage.content, MAX_TITLE_CHARS);
  return FALLBACK_TITLE;
};

/**
 * Build the deterministic data model for the branded conversation share image.
 * The share card always uses the fixed brand light canvas, so this model must
 * stay independent of the user's runtime theme preset.
 */
export const buildShareCardModel = (
  messages: readonly ChatMessage[],
  title?: string,
  now: Date = new Date(),
): ShareCardModel | null => {
  const shareable = messages
    .filter(isShareableMessage)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: resolveMessageContent(message),
    }))
    .filter((message) => message.content.length > 0);
  if (shareable.length === 0) return null;

  const capped = shareable.slice(0, MAX_SHARE_CARD_MESSAGES).map((message) => ({
    id: message.id,
    role: message.role,
    content: truncateCodePoints(message.content, MAX_SHARE_CARD_MESSAGE_CHARS),
  }));

  return {
    title: deriveTitle(title, capped),
    date: formatDate(now),
    messages: capped,
    totalCount: shareable.length,
    truncated: shareable.length > capped.length,
  };
};
