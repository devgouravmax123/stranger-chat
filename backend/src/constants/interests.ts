/**
 * Canonical interest list for ChatBuddy.
 * Single source of truth for Profile preferences, Discover People filters, and Matchmaking.
 */
export const CANONICAL_INTERESTS = [
  'Coding',
  'Gaming',
  'Music',
  'Movies',
  'Sports',
  'Travel',
  'Anime',
  'Reading',
  'Fitness',
] as const;

export type CanonicalInterest = (typeof CANONICAL_INTERESTS)[number];

export const CANONICAL_GOALS = [
  { value: 'casual-chat', label: 'Casual Chat' },
  { value: 'friendship', label: 'Friendship' },
  { value: 'learning', label: 'Language & Learning' },
  { value: 'networking', label: 'Networking' },
] as const;

export type CanonicalGoal = (typeof CANONICAL_GOALS)[number]['value'];

/**
 * Maps a stored goal string to its human-readable label.
 * Returns "No goal selected" if null or empty.
 */
export function formatGoal(goal: string | null | undefined): string {
  if (!goal || typeof goal !== 'string') return 'No goal selected';
  const trimmed = goal.trim();
  if (!trimmed) return 'No goal selected';

  const found = CANONICAL_GOALS.find(
    (g) => g.value.toLowerCase() === trimmed.toLowerCase(),
  );
  if (found) return found.label;

  return trimmed
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Normalizes an interest string to its canonical representation if a case-insensitive
 * match exists in CANONICAL_INTERESTS; otherwise returns the trimmed string.
 */
export function normalizeInterest(interest: string): string {
  if (!interest || typeof interest !== 'string') return '';
  const trimmed = interest.trim();
  const match = CANONICAL_INTERESTS.find(
    (c) => c.toLowerCase() === trimmed.toLowerCase(),
  );
  return match || trimmed;
}
