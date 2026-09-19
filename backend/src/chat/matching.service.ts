import { Injectable } from '@nestjs/common';
import { normalizeInterest } from '../constants/interests.js';

export interface MatchPreferences {
  language: string;
  interests: string[];
  goal: string;
}

@Injectable()
export class MatchingService {
  /**
   * Language score: maximum 40 points.
   * Matches case-insensitively and trims whitespace.
   */
  public calculateLanguageScore(
    userA?: Partial<MatchPreferences> | null,
    userB?: Partial<MatchPreferences> | null,
  ): number {
    const langA = (userA?.language || '').trim().toLowerCase();
    const langB = (userB?.language || '').trim().toLowerCase();

    if (!langA || !langB) {
      return 0;
    }

    return langA === langB ? 40 : 0;
  }

  /**
   * Interest score: maximum 40 points.
   *
   * Uses Jaccard similarity:
   * (intersection / union) * 40
   *
   * Normalized case-insensitively with canonical interest matching.
   */
  public calculateInterestScore(
    userA?: Partial<MatchPreferences> | null,
    userB?: Partial<MatchPreferences> | null,
  ): number {
    const rawListA = Array.isArray(userA?.interests) ? userA.interests : [];
    const rawListB = Array.isArray(userB?.interests) ? userB.interests : [];

    const interestsA = new Set(
      rawListA
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeInterest(item).toLowerCase())
        .filter(Boolean),
    );

    const interestsB = new Set(
      rawListB
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeInterest(item).toLowerCase())
        .filter(Boolean),
    );

    if (interestsA.size === 0 && interestsB.size === 0) {
      return 0;
    }

    const intersection = [...interestsA].filter((interest) =>
      interestsB.has(interest),
    );

    const union = new Set([...interestsA, ...interestsB]);
    if (union.size === 0) {
      return 0;
    }

    return (intersection.length / union.size) * 40;
  }

  /**
   * Conversation goal score: maximum 20 points.
   * Matches case-insensitively and trims whitespace.
   */
  public calculateGoalScore(
    userA?: Partial<MatchPreferences> | null,
    userB?: Partial<MatchPreferences> | null,
  ): number {
    const goalA = (userA?.goal || '').trim().toLowerCase();
    const goalB = (userB?.goal || '').trim().toLowerCase();

    if (!goalA || !goalB) {
      return 0;
    }

    return goalA === goalB ? 20 : 0;
  }

  /**
   * Calculates the complete compatibility score.
   *
   * Formula:
   * Language (max 40) + Interests (max 40) + Goal (max 20) = Max 100
   *
   * Deterministic, bounded between 0 and 100, and rounded canonically to an integer.
   */
  public calculateMatchScore(
    userA?: Partial<MatchPreferences> | null,
    userB?: Partial<MatchPreferences> | null,
  ): number {
    const languageScore = this.calculateLanguageScore(userA, userB);
    const interestScore = this.calculateInterestScore(userA, userB);
    const goalScore = this.calculateGoalScore(userA, userB);

    const rawTotal = languageScore + interestScore + goalScore;
    const rounded = Math.round(rawTotal);

    return Math.max(0, Math.min(100, rounded));
  }

  /**
   * Finds the highest-scoring stranger candidate from a list of candidates.
   */
  public findBestMatch(
    user: MatchPreferences,
    candidates: MatchPreferences[],
  ): { candidate: MatchPreferences; score: number } | null {
    if (!candidates || candidates.length === 0) {
      return null;
    }

    let bestCandidate = candidates[0];
    let bestScore = this.calculateMatchScore(user, bestCandidate);

    for (let i = 1; i < candidates.length; i++) {
      const score = this.calculateMatchScore(user, candidates[i]);

      if (score > bestScore) {
        bestCandidate = candidates[i];
        bestScore = score;
      }
    }

    return {
      candidate: bestCandidate,
      score: bestScore,
    };
  }
}