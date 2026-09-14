import { Injectable } from '@nestjs/common';

export interface MatchPreferences {
  language: string;
  interests: string[];
  goal: string;
}

@Injectable()
export class MatchingService {
  /**
   * Language score: maximum 40 points.
   */
  private calculateLanguageScore(
    userA: MatchPreferences,
    userB: MatchPreferences,
  ): number {
    return userA.language.toLowerCase() === userB.language.toLowerCase()
      ? 40
      : 0;
  }

  /**
   * Interest score: maximum 40 points.
   *
   * Jaccard similarity:
   * intersection / union × 40
   */
  private calculateInterestScore(
    userA: MatchPreferences,
    userB: MatchPreferences,
  ): number {
    const interestsA = new Set(
      userA.interests.map((interest) => interest.toLowerCase().trim()),
    );

    const interestsB = new Set(
      userB.interests.map((interest) => interest.toLowerCase().trim()),
    );

    if (interestsA.size === 0 && interestsB.size === 0) {
      return 0;
    }

    const intersection = [...interestsA].filter((interest) =>
      interestsB.has(interest),
    );

    const union = new Set([...interestsA, ...interestsB]);

    return (intersection.length / union.size) * 40;
  }

  /**
   * Conversation goal score: maximum 20 points.
   */
  private calculateGoalScore(
    userA: MatchPreferences,
    userB: MatchPreferences,
  ): number {
    return userA.goal.toLowerCase().trim() === userB.goal.toLowerCase().trim()
      ? 20
      : 0;
  }

  /**
   * Calculates the complete compatibility score.
   *
   * Maximum = 100
   */
  calculateMatchScore(
    userA: MatchPreferences,
    userB: MatchPreferences,
  ): number {
    const languageScore = this.calculateLanguageScore(userA, userB);
    const interestScore = this.calculateInterestScore(userA, userB);
    const goalScore = this.calculateGoalScore(userA, userB);

    return languageScore + interestScore + goalScore;
  }

  /**
   * Finds the highest-scoring stranger.
   */
  findBestMatch(
    user: MatchPreferences,
    candidates: MatchPreferences[],
  ): { candidate: MatchPreferences; score: number } | null {
    if (candidates.length === 0) {
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