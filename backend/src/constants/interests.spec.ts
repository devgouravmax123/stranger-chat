import { describe, it, expect } from 'vitest';
import {
  CANONICAL_INTERESTS,
  CANONICAL_GOALS,
  formatGoal,
  normalizeInterest,
} from './interests.js';

describe('Interests and Goals Constants & Helpers', () => {
  describe('CANONICAL_INTERESTS', () => {
    it('should contain all 9 canonical interests', () => {
      expect(CANONICAL_INTERESTS).toEqual([
        'Coding',
        'Gaming',
        'Music',
        'Movies',
        'Sports',
        'Travel',
        'Anime',
        'Reading',
        'Fitness',
      ]);
    });
  });

  describe('formatGoal', () => {
    it('should return human-readable label for canonical goals', () => {
      expect(formatGoal('casual-chat')).toBe('Casual Chat');
      expect(formatGoal('friendship')).toBe('Friendship');
      expect(formatGoal('learning')).toBe('Language & Learning');
      expect(formatGoal('networking')).toBe('Networking');
    });

    it('should handle case-insensitive matching and whitespace', () => {
      expect(formatGoal('  CASUAL-CHAT  ')).toBe('Casual Chat');
      expect(formatGoal('Friendship')).toBe('Friendship');
    });

    it('should convert custom kebab-case goals to title case', () => {
      expect(formatGoal('deep-conversations')).toBe('Deep Conversations');
      expect(formatGoal('book-club')).toBe('Book Club');
    });

    it('should return "No goal selected" for null, undefined, empty, or non-string inputs', () => {
      expect(formatGoal(null)).toBe('No goal selected');
      expect(formatGoal(undefined)).toBe('No goal selected');
      expect(formatGoal('')).toBe('No goal selected');
      expect(formatGoal('   ')).toBe('No goal selected');
      expect(formatGoal(123 as any)).toBe('No goal selected');
    });
  });

  describe('normalizeInterest', () => {
    it('should normalize case-insensitive match to canonical casing', () => {
      expect(normalizeInterest('coding')).toBe('Coding');
      expect(normalizeInterest('GAMING')).toBe('Gaming');
      expect(normalizeInterest('  anime  ')).toBe('Anime');
      expect(normalizeInterest('fitness')).toBe('Fitness');
    });

    it('should return trimmed interest if not in canonical list', () => {
      expect(normalizeInterest('  Astronomy  ')).toBe('Astronomy');
      expect(normalizeInterest('Photography')).toBe('Photography');
    });

    it('should return empty string for null, undefined, non-string or whitespace', () => {
      expect(normalizeInterest(null as any)).toBe('');
      expect(normalizeInterest(undefined as any)).toBe('');
      expect(normalizeInterest('')).toBe('');
      expect(normalizeInterest('   ')).toBe('');
      expect(normalizeInterest(42 as any)).toBe('');
    });
  });
});
