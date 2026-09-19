import { describe, it, expect, beforeEach } from 'vitest';
import { MatchingService, MatchPreferences } from './matching.service.js';

describe('MatchingService', () => {
  let service: MatchingService;

  beforeEach(() => {
    service = new MatchingService();
  });

  describe('calculateLanguageScore', () => {
    it('should award 40 points for exact match', () => {
      const userA: MatchPreferences = { language: 'English', interests: [], goal: 'casual-chat' };
      const userB: MatchPreferences = { language: 'English', interests: [], goal: 'casual-chat' };
      expect(service.calculateLanguageScore(userA, userB)).toBe(40);
    });

    it('should match case-insensitively and trim whitespace', () => {
      const userA = { language: '  english  ' };
      const userB = { language: 'ENGLISH' };
      expect(service.calculateLanguageScore(userA, userB)).toBe(40);
    });

    it('should return 0 points for different languages', () => {
      const userA = { language: 'English' };
      const userB = { language: 'Hindi' };
      expect(service.calculateLanguageScore(userA, userB)).toBe(0);
    });

    it('should return 0 if either language is empty or undefined', () => {
      expect(service.calculateLanguageScore({ language: '' }, { language: 'English' })).toBe(0);
      expect(service.calculateLanguageScore(undefined, { language: 'English' })).toBe(0);
      expect(service.calculateLanguageScore({ language: 'English' }, null)).toBe(0);
    });
  });

  describe('calculateInterestScore', () => {
    it('should award 40 points for identical interest sets', () => {
      const userA = { interests: ['Coding', 'Gaming', 'Anime'] };
      const userB = { interests: ['Anime', 'Coding', 'Gaming'] };
      expect(service.calculateInterestScore(userA, userB)).toBe(40);
    });

    it('should calculate Jaccard similarity accurately for partial overlaps', () => {
      // Intersection: 2 (Coding, Gaming)
      // Union: 4 (Coding, Gaming, Anime, Music)
      // Jaccard: (2 / 4) * 40 = 20
      const userA = { interests: ['Coding', 'Gaming', 'Anime'] };
      const userB = { interests: ['Coding', 'Gaming', 'Music'] };
      expect(service.calculateInterestScore(userA, userB)).toBe(20);
    });

    it('should return 0 points for completely disjoint interests', () => {
      const userA = { interests: ['Coding', 'Gaming'] };
      const userB = { interests: ['Music', 'Movies'] };
      expect(service.calculateInterestScore(userA, userB)).toBe(0);
    });

    it('should normalize case and whitespace canonically', () => {
      const userA = { interests: ['  coding  ', 'GAMING'] };
      const userB = { interests: ['Coding', 'gaming'] };
      expect(service.calculateInterestScore(userA, userB)).toBe(40);
    });

    it('should return 0 if both interest sets are empty or missing', () => {
      expect(service.calculateInterestScore({ interests: [] }, { interests: [] })).toBe(0);
      expect(service.calculateInterestScore(undefined, undefined)).toBe(0);
      expect(service.calculateInterestScore({ interests: [] }, { interests: ['Coding'] })).toBe(0);
    });

    it('should filter out invalid non-string items', () => {
      const userA = { interests: ['Coding', null as any, 123 as any] };
      const userB = { interests: ['Coding'] };
      expect(service.calculateInterestScore(userA, userB)).toBe(40);
    });
  });

  describe('calculateGoalScore', () => {
    it('should award 20 points for identical goals', () => {
      const userA = { goal: 'casual-chat' };
      const userB = { goal: 'casual-chat' };
      expect(service.calculateGoalScore(userA, userB)).toBe(20);
    });

    it('should match case-insensitively and trim whitespace', () => {
      const userA = { goal: '  FRIENDSHIP  ' };
      const userB = { goal: 'friendship' };
      expect(service.calculateGoalScore(userA, userB)).toBe(20);
    });

    it('should return 0 for different goals', () => {
      const userA = { goal: 'casual-chat' };
      const userB = { goal: 'learning' };
      expect(service.calculateGoalScore(userA, userB)).toBe(0);
    });

    it('should return 0 if goal is empty or undefined', () => {
      expect(service.calculateGoalScore(undefined, { goal: 'friendship' })).toBe(0);
      expect(service.calculateGoalScore({ goal: '' }, { goal: 'friendship' })).toBe(0);
    });
  });

  describe('calculateMatchScore', () => {
    it('should return 100 for a perfect match across language, interests, and goal', () => {
      const userA: MatchPreferences = {
        language: 'English',
        interests: ['Coding', 'Gaming', 'Music'],
        goal: 'casual-chat',
      };
      const userB: MatchPreferences = {
        language: 'English',
        interests: ['Coding', 'Gaming', 'Music'],
        goal: 'casual-chat',
      };
      expect(service.calculateMatchScore(userA, userB)).toBe(100);
    });

    it('should return 0 when nothing matches', () => {
      const userA: MatchPreferences = {
        language: 'English',
        interests: ['Coding'],
        goal: 'casual-chat',
      };
      const userB: MatchPreferences = {
        language: 'Hindi',
        interests: ['Fitness'],
        goal: 'networking',
      };
      expect(service.calculateMatchScore(userA, userB)).toBe(0);
    });

    it('should correctly sum partial scores and round to an integer bounded in [0, 100]', () => {
      // Lang: 40
      // Interests: 1 / 3 * 40 = 13.333
      // Goal: 20
      // Total: 40 + 13.333 + 20 = 73.333 -> rounds to 73
      const userA: MatchPreferences = {
        language: 'Spanish',
        interests: ['Travel', 'Movies'],
        goal: 'friendship',
      };
      const userB: MatchPreferences = {
        language: 'Spanish',
        interests: ['Travel', 'Anime'],
        goal: 'friendship',
      };
      expect(service.calculateMatchScore(userA, userB)).toBe(73);
    });
  });

  describe('findBestMatch', () => {
    it('should return null when candidate list is empty', () => {
      const user: MatchPreferences = { language: 'English', interests: ['Coding'], goal: 'casual-chat' };
      expect(service.findBestMatch(user, [])).toBeNull();
    });

    it('should return the sole candidate when only one candidate is available', () => {
      const user: MatchPreferences = { language: 'English', interests: ['Coding'], goal: 'casual-chat' };
      const candidate: MatchPreferences = { language: 'English', interests: ['Coding'], goal: 'casual-chat' };
      const result = service.findBestMatch(user, [candidate]);
      expect(result).not.toBeNull();
      expect(result?.candidate).toBe(candidate);
      expect(result?.score).toBe(100);
    });

    it('should choose candidate with the highest compatibility score', () => {
      const user: MatchPreferences = {
        language: 'English',
        interests: ['Coding', 'Gaming'],
        goal: 'friendship',
      };

      const candidateA: MatchPreferences = {
        language: 'Hindi',
        interests: ['Travel'],
        goal: 'casual-chat',
      }; // score: 0

      const candidateB: MatchPreferences = {
        language: 'English',
        interests: ['Music'],
        goal: 'casual-chat',
      }; // score: 40 (lang only)

      const candidateC: MatchPreferences = {
        language: 'English',
        interests: ['Coding', 'Gaming'],
        goal: 'friendship',
      }; // score: 100

      const result = service.findBestMatch(user, [candidateA, candidateB, candidateC]);
      expect(result?.candidate).toBe(candidateC);
      expect(result?.score).toBe(100);
    });
  });
});
