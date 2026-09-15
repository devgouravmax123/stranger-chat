import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ConversationSuggestionsDto } from './dto/conversation-suggestions.dto.js';
import { GeminiService } from './gemini.service.js';

@Controller('ai')
export class GeminiController {
  private readonly logger = new Logger(GeminiController.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly redisService: RedisService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post('conversation-suggestions')
  @HttpCode(HttpStatus.OK)
  async getSuggestions(
    @Body() dto: ConversationSuggestionsDto,
    @Req() req: Request,
  ) {
    const conversationId = dto.conversationId?.trim() || 'unknown';

    // 1. Filter meaningful text messages
    const meaningfulMessages = (dto.messages || []).filter(
      (m) => m && typeof m.text === 'string' && m.text.trim().length > 0,
    );

    // 2. Strict User Identification: Reject generic/shared placeholders
    const rawUserId = dto.userId?.trim();
    if (!rawUserId || rawUserId === 'me' || rawUserId === 'anonymous') {
      this.logger.warn(`[AI Suggestions] Request rejected: Invalid or shared userId '${rawUserId}'`);
      throw new HttpException(
        {
          error: 'A valid user session is required for AI suggestions. Please ensure you are connected.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Verify canonical user identity against database if available
    let validUserId = rawUserId;
    try {
      const dbUser = await this.prismaService.user.findUnique({
        where: { id: rawUserId },
        select: { id: true },
      });
      if (dbUser) {
        validUserId = dbUser.id;
      }
    } catch {}

    this.logger.log(`[AI Suggestions] Request received`);
    this.logger.log(`[AI Suggestions] userId: ${validUserId}`);
    this.logger.log(`[AI Suggestions] conversationId: ${conversationId}`);
    this.logger.log(`[AI Suggestions] messageCount: ${dto.messages?.length || 0}`);
    this.logger.log(`[AI Suggestions] textMessageCount: ${meaningfulMessages.length}`);

    // 3. Minimum Context Validation
    if (meaningfulMessages.length === 0) {
      return {
        suggestions: [],
        message: 'Start chatting first, then I can suggest topics based on your conversation.',
      };
    }

    if (meaningfulMessages.length < 3) {
      return {
        suggestions: [],
        message: "Chat a little more and I'll find some ideas for you.",
      };
    }

    // 4. User Cooldown Check (10s UX Cooldown)
    const cooldownSeconds = parseInt(
      process.env.AI_SUGGESTION_COOLDOWN_SECONDS || '10',
      10,
    );
    const cooldownKey = `ai:cooldown:${validUserId}`;
    const isCooldownActive = await this.redisService.exists(cooldownKey);

    if (isCooldownActive) {
      const remaining = await this.redisService.ttl(cooldownKey);
      this.logger.log(`[AI Suggestions] cooldownAllowed: false (remaining: ${remaining}s)`);
      throw new HttpException(
        {
          error: 'Please wait before requesting new suggestions.',
          cooldownRemaining: remaining > 0 ? remaining : cooldownSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.logger.log(`[AI Suggestions] cooldownAllowed: true`);

    // 5. User Daily Quota Check (Default 5 requests/day, India Timezone basis)
    const dailyLimit = parseInt(
      process.env.AI_SUGGESTION_DAILY_LIMIT || '5',
      10,
    );
    // Consistent date basis in IST (Asia/Kolkata, UTC+5:30)
    const todayDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
    }).format(new Date());

    const userDailyKey = `ai:daily-usage:${validUserId}:${todayDate}`;
    const userDailyUsageStr = await this.redisService.get(userDailyKey);
    const userDailyUsage = userDailyUsageStr ? parseInt(userDailyUsageStr, 10) : 0;

    this.logger.log(`[AI Quota] userId: ${validUserId}`);
    this.logger.log(`[AI Quota] dailyKey: ${userDailyKey}`);
    this.logger.log(`[AI Quota] currentUsage: ${userDailyUsage}`);
    this.logger.log(`[AI Quota] dailyLimit: ${dailyLimit}`);
    this.logger.log(`[AI Quota] allowed: ${userDailyUsage < dailyLimit}`);

    if (userDailyUsage >= dailyLimit) {
      throw new HttpException(
        {
          error: `You've reached your daily limit of ${dailyLimit} suggestion requests. Please try again tomorrow.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 5. Context Hash & Match-Scoped Cache Check
    const contextTranscript = meaningfulMessages
      .slice(-15)
      .map((m) => `${m.sender}:${m.text.trim()}`)
      .join('\n');
    const contextHash = createHash('sha256')
      .update(contextTranscript)
      .digest('hex')
      .slice(0, 16);

    const cacheKey = `ai:suggestions:${conversationId}:${contextHash}`;

    // If no previous suggestions passed, check for existing cached generation
    if (
      conversationId !== 'unknown' &&
      (!dto.previousSuggestions || dto.previousSuggestions.length === 0)
    ) {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length === 3) {
            this.logger.log(`[AI Suggestions] cacheHit: true`);
            // Cache hits do NOT consume daily limits or global RPM
            return {
              suggestions: parsed,
              cached: true,
              cooldownSeconds,
            };
          }
        } catch {}
      }
    }
    this.logger.log(`[AI Suggestions] cacheHit: false`);

    // 6. Global Project Protection (15 RPM / 500 RPD)
    const globalRpmLimit = parseInt(
      process.env.AI_GLOBAL_RPM_LIMIT || '15',
      10,
    );
    const globalRpdLimit = parseInt(
      process.env.AI_GLOBAL_RPD_LIMIT || '500',
      10,
    );
    const currentMinute = new Date().toISOString().slice(0, 16);
    const rpmKey = `ai:global:rpm:${currentMinute}`;
    const rpdKey = `ai:global:rpd:${todayDate}`;

    const currentRpmStr = await this.redisService.get(rpmKey);
    const currentRpm = currentRpmStr ? parseInt(currentRpmStr, 10) : 0;
    const currentRpdStr = await this.redisService.get(rpdKey);
    const currentRpd = currentRpdStr ? parseInt(currentRpdStr, 10) : 0;

    if (currentRpm >= globalRpmLimit || currentRpd >= globalRpdLimit) {
      this.logger.warn(
        `[AI Suggestions] globalRateAllowed: false (RPM: ${currentRpm}/${globalRpmLimit}, RPD: ${currentRpd}/${globalRpdLimit})`,
      );
      throw new HttpException(
        {
          error: 'AI suggestions are busy right now. Please try again shortly.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.logger.log(`[AI Suggestions] globalRateAllowed: true`);

    // 7. Concurrency Admission Gate (Max 4 in-flight simultaneous Gemini requests)
    const inflightKey = 'ai:global:inflight';
    const inflightCount = await this.redisService.incr(inflightKey, 15);
    if (inflightCount > 4) {
      await this.redisService.decr(inflightKey);
      this.logger.warn(`[AI Suggestions] Admission gate saturated (${inflightCount} in-flight)`);
      throw new HttpException(
        {
          error: 'AI suggestions are busy right now. Please try again shortly.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 8. Atomic User Quota Reservation (Race-condition safe under multi-tab / concurrent clicks)
    const reservedDaily = await this.redisService.incr(userDailyKey, 86400 * 2);
    if (reservedDaily > dailyLimit) {
      await this.redisService.decr(userDailyKey);
      this.logger.warn(
        `[AI Quota] Atomic limit exceeded for ${validUserId}: ${reservedDaily} > ${dailyLimit}`,
      );
      throw new HttpException(
        {
          error: `You've reached your daily limit of ${dailyLimit} suggestion requests. Please try again tomorrow.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 9. Execute Gemini Call with Safe Resource Release & Rollback on Error
    try {
      this.logger.log(`[AI Suggestions] geminiCalled: true`);
      const suggestions = await this.geminiService.generateConversationSuggestions(
        meaningfulMessages,
        conversationId,
        dto.previousSuggestions,
      );

      // On SUCCESS:
      // A) Keep the reserved quota slot
      this.logger.log(`[AI Quota] Reserved slot committed: ${reservedDaily}/${dailyLimit}`);

      // B) Increment Global RPM and RPD
      await this.redisService.incr(rpmKey, 70);
      await this.redisService.incr(rpdKey, 90000);

      // C) Start User Cooldown ONLY on success
      await this.redisService.set(cooldownKey, '1', cooldownSeconds);

      // D) Save to Conversation-Scoped Cache
      if (conversationId && conversationId !== 'unknown') {
        await this.redisService.set(cacheKey, JSON.stringify(suggestions), 300);
      }

      this.logger.log(`[AI Suggestions] geminiSuccess: true`);
      return {
        suggestions,
        cached: false,
        cooldownSeconds,
      };
    } catch (err: any) {
      this.logger.error(`[AI Suggestions] geminiSuccess: false - ${err.message}`);

      // Rollback the reserved user daily quota so user is not penalized for failures
      await this.redisService.decr(userDailyKey);
      this.logger.log(`[AI Quota] Rolled back quota reservation for ${validUserId}`);

      // Handle failure cases specifically
      if (err.message === 'RATE_LIMIT') {
        throw new HttpException(
          {
            error: 'AI suggestions are busy right now. Please try again shortly.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (err.message === 'TIMEOUT') {
        throw new HttpException(
          {
            error: 'Request timed out. Please try again.',
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }

      if (err.message === 'MALFORMED_RESPONSE') {
        throw new HttpException(
          {
            error: 'Invalid AI response. Please try again.',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      throw new HttpException(
        {
          error: "Couldn't generate suggestions right now. Please try again.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      // Release in-flight slot immediately
      await this.redisService.decr(inflightKey);
    }
  }
}
