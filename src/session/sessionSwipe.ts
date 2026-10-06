export const SESSION_SWIPE_OPEN_THRESHOLD = 44;

export function resolveSessionSwipeOpen(
  currentOpen: boolean,
  contentOffsetX: number,
  actionsWidth: number,
  threshold = SESSION_SWIPE_OPEN_THRESHOLD,
): boolean {
  if (actionsWidth <= 0) return false;

  const offset = Math.max(0, Math.min(actionsWidth, contentOffsetX));

  if (currentOpen) {
    return offset > actionsWidth - threshold;
  }

  return offset >= threshold;
}
