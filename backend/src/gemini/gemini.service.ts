import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

// Load .env reliably
config();
if (existsSync(resolve(process.cwd(), 'backend', '.env'))) {
  config({ path: resolve(process.cwd(), 'backend', '.env'), override: true });
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private client: GoogleGenAI | null = null;
  private currentApiKey: string | null = null;
  private readonly modelName: string;

  constructor() {
    this.modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';

    let envPathLoaded = 'none';
    const candidateEnvPaths = [
      resolve(process.cwd(), 'backend', '.env'),
      resolve(process.cwd(), '.env'),
    ];
    for (const p of candidateEnvPaths) {
      if (existsSync(p)) {
        envPathLoaded = p;
        break;
      }
    }

    const rawKey = process.env.GEMINI_API_KEY?.trim() || '';
    const keyExists = rawKey.length > 0;

    this.logger.log(`[Gemini Diagnostics] cwd: ${process.cwd()}`);
    this.logger.log(`[Gemini Diagnostics] env file path: ${envPathLoaded}`);
    this.logger.log(`[Gemini Diagnostics] GEMINI_API_KEY exists: ${keyExists}`);
    this.logger.log(`[Gemini Diagnostics] GEMINI_API_KEY length: ${rawKey.length}`);
    this.logger.log(`[Gemini Diagnostics] GEMINI_MODEL: ${this.modelName}`);

    const isLoaded = this.ensureClientInitialized();
    this.logger.log(`[Gemini Config] GEMINI_API_KEY loaded: ${isLoaded}`);
    this.logger.log(`[Gemini Config] GEMINI_MODEL: ${this.modelName}`);
  }

  /**
   * Initializes or updates GoogleGenAI client if API key is present/changed.
   */
  ensureClientInitialized(): boolean {
    // Reload env dynamically to pick up changes in backend/.env
    const candidateEnvPaths = [
      resolve(process.cwd(), 'backend', '.env'),
      resolve(process.cwd(), '.env'),
    ];
    for (const envPath of candidateEnvPaths) {
      if (existsSync(envPath)) {
        config({ path: envPath, override: true });
        break;
      }
    }

    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.GEMINI_KEY?.trim();

    if (!apiKey) {
      this.client = null;
      this.currentApiKey = null;
      return false;
    }

    if (!this.client || this.currentApiKey !== apiKey) {
      try {
        this.client = new GoogleGenAI({ apiKey });
        this.currentApiKey = apiKey;
        this.logger.log(`[Gemini Config] Gemini client initialized with model: ${this.modelName}`);
      } catch (err: any) {
        this.logger.warn(`[Gemini Config] Failed to initialize Gemini client: ${err.message}`);
        this.client = null;
        return false;
      }
    }
    return true;
  }

  /**
   * Generates 3 context-aware, multilingual conversation suggestions.
   * Detects the conversation language/style (English, Hindi, Hinglish, regional)
   * and generates relevant questions in the SAME language and tone.
   * Avoids repeating previous suggestions from the current match.
   */
  async generateConversationSuggestions(
    messages: { sender: string; text: string }[],
    conversationId?: string,
    previousSuggestions?: string[],
  ): Promise<string[]> {
    // 1. Filter meaningful text messages
    const cleanedMessages = (messages || [])
      .filter((m) => m && typeof m.text === 'string' && m.text.trim().length > 0)
      .slice(-15)
      .map((m) => {
        const role = m.sender === 'me' ? 'User' : 'Stranger';
        const text = m.text.trim().slice(0, 300);
        return `${role}: ${text}`;
      });

    if (cleanedMessages.length === 0) {
      this.logger.log(`[AI Suggestions] textMessageCount: 0. Returning empty suggestions.`);
      return [];
    }

    // 2. Ensure Gemini client is initialized
    const hasClient = this.ensureClientInitialized();
    if (!hasClient || !this.client) {
      this.logger.error(`[AI Suggestions] Gemini ERROR - status: 500 - message: GEMINI_API_KEY is not configured or empty in backend/.env`);
      return [];
    }

    const conversationTranscript = cleanedMessages.join('\n');

    // 3. Multilingual, context-preserving system prompt
    const systemInstruction = `You are a conversation assistant helping two strangers continue a natural conversation on Chirp.

Analyze only their recent conversation.

Generate exactly 3 short discussion prompts that are relevant to what they are currently discussing.

Rules:
- Use the current conversation as the PRIMARY context.
- Do not repeat topics/questions already discussed.
- Avoid generic unrelated questions when meaningful context exists.
- Keep the questions natural and friendly.
- Do not be overly personal.
- Avoid sensitive/private topics.
- Match the tone of the conversation.
- Match the language/style of the conversation:
  * English conversation -> English suggestions.
  * Hindi conversation -> Hindi suggestions.
  * Hinglish conversation (e.g., "bhai aaj kya kar rha hai", "bore ho rha hu") -> natural, colloquial Hinglish suggestions.
  * Regional languages (Kannada, Tamil, Telugu, Marathi, Bengali, etc.) -> same regional language and style.
  * Mixed language -> preserve the natural conversational blend.
- Understand internet slang, casual abbreviations, and emojis ("wyd", "bro", "bhai", "yaar", "lol", "😂", "wbu", "kaise ho").
- Do not pretend to participate in the conversation.
- Return structured JSON only: a JSON array of exactly 3 strings.
- Each suggestion must be under 20 words.
Example format:
["Suggestion 1", "Suggestion 2", "Suggestion 3"]`;

    // 4. Per-match repetition avoidance
    const previousAvoidance =
      previousSuggestions && previousSuggestions.length > 0
        ? `\nPREVIOUS SUGGESTIONS ALREADY SHOWN IN THIS CHAT (DO NOT REPEAT THESE OR SIMILAR QUESTIONS):\n${previousSuggestions.map((s) => `- "${s}"`).join('\n')}\n`
        : '';

    const userPrompt = `Here is the recent conversation transcript:\n\n${conversationTranscript}\n${previousAvoidance}\nPlease generate 3 new, context-aware discussion questions in a JSON array of strings matching the language and tone.`;

    this.logger.log(`[AI Suggestions] Calling Gemini...`);
    this.logger.log(`[AI Suggestions] calling Gemini: ${this.modelName}`);

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GEMINI_TIMEOUT')), 10000),
      );

      const callPromise = this.client.models.generateContent({
        model: this.modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      });

      const response = await Promise.race([callPromise, timeoutPromise]);
      const responseText = response.text?.trim();

      this.logger.log(`[AI Suggestions] Gemini success`);
      this.logger.log(`[AI Suggestions] Gemini success: true`);
      this.logger.log(`[AI Suggestions] Gemini response: ${responseText}`);
      this.logger.log(`[AI Suggestions] parsing response: verifying 3 strings`);

      if (!responseText) {
        this.logger.error(`[AI Suggestions] Gemini ERROR - status: 500 - message: Empty response from model`);
        throw new Error('MALFORMED_RESPONSE');
      }

      const suggestions = this.validateAndExtractSuggestions(responseText);
      if (suggestions && suggestions.length === 3) {
        this.logger.log(`[AI Suggestions] responseValid: true`);
        this.logger.log(`[AI Suggestions] returning suggestions: ${JSON.stringify(suggestions)}`);
        return suggestions;
      }

      this.logger.error(`[AI Suggestions] Gemini ERROR - status: 422 - message: Failed to parse exactly 3 valid suggestions array from response`);
      throw new Error('MALFORMED_RESPONSE');
    } catch (err: any) {
      if (err.message === 'GEMINI_TIMEOUT') {
        this.logger.error(`[AI Suggestions] Gemini ERROR - status: 504 - message: Network timeout calling Gemini API`);
        throw new Error('TIMEOUT');
      }
      if (err.message === 'MALFORMED_RESPONSE') {
        throw new Error('MALFORMED_RESPONSE');
      }
      const isRateLimit =
        err?.status === 429 ||
        err?.message?.includes('429') ||
        err?.message?.toLowerCase().includes('quota') ||
        err?.message?.toLowerCase().includes('resource has been exhausted');
      if (isRateLimit) {
        this.logger.error(`[AI Suggestions] Gemini ERROR - status: 429 - message: Gemini quota or rate limit exceeded`);
        throw new Error('RATE_LIMIT');
      }
      this.logger.error(`[AI Suggestions] Gemini ERROR - status: ${err?.status || 500} - message: ${err?.message || 'Unknown error'}`);
      throw new Error('SERVICE_UNAVAILABLE');
    }
  }

  /**
   * Safely parses and validates the Gemini response ensuring it's a string array of exactly 3 items.
   */
  private validateAndExtractSuggestions(raw: string): string[] | null {
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          return null;
        }
      }

      if (!Array.isArray(parsed)) {
        return null;
      }

      const validStrings = parsed
        .filter((item): item is string => typeof item === 'string' && item.trim().length >= 3 && item.trim().length <= 150)
        .map((item) => item.trim());

      return validStrings.length === 3 ? validStrings : null;
    } catch {
      return null;
    }
  }
}
