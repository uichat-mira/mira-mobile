import type { ChatMessage } from '../types';
import {
  collectShareableMessages,
  MAX_SHARE_CARD_MESSAGES,
  resolveShareMessageContent,
} from './shareCardModel';

/** One selectable row in the pre-share selector. */
export interface ShareSelectionRow {
  id: string;
  role: 'user' | 'assistant';
  /** Resolved, untruncated text used for the row preview. */
  content: string;
}

export const buildShareSelectionRows = (
  messages: readonly ChatMessage[],
): ShareSelectionRow[] =>
  collectShareableMessages(messages).map((message) => ({
    id: message.id,
    role: message.role,
    content: resolveShareMessageContent(message),
  }));

/**
 * Default to everything selected: before this selector existed the app shared
 * the whole conversation, so "all selected" preserves that expectation while
 * letting the user opt messages out.
 */
export const defaultShareSelection = (
  rows: readonly ShareSelectionRow[],
): Set<string> => new Set(rows.map((row) => row.id));

export const toggleShareSelection = (
  current: ReadonlySet<string>,
  id: string,
): Set<string> => {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export const countSelected = (
  rows: readonly ShareSelectionRow[],
  selected: ReadonlySet<string>,
): number =>
  rows.reduce((total, row) => (selected.has(row.id) ? total + 1 : total), 0);

/** Selected ids in conversation order, so the card keeps the original sequence. */
export const selectedShareMessageIds = (
  rows: readonly ShareSelectionRow[],
  selected: ReadonlySet<string>,
): string[] =>
  rows.filter((row) => selected.has(row.id)).map((row) => row.id);

export const selectedExceedsCardCap = (
  rows: readonly ShareSelectionRow[],
  selected: ReadonlySet<string>,
): boolean => countSelected(rows, selected) > MAX_SHARE_CARD_MESSAGES;
