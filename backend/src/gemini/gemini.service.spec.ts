import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GeminiService } from './gemini.service.js';

describe('GeminiService', () => {
  let service: GeminiService;

  beforeEach(() => {
    service = new GeminiService();
  });

  describe('generateConversationSuggestions', () => {
    it('should return empty array if messages list is empty', async () => {
      const suggestions = await service.generateConversationSuggestions([]);
      expect(suggestions).toEqual([]);
    });

    it('should return empty array if all messages are empty or whitespace', async () => {
      const suggestions = await service.generateConversationSuggestions([
        { sender: 'me', text: '   ' },
        { sender: 'stranger', text: '' },
      ]);
      expect(suggestions).toEqual([]);
    });

    it('should return empty array if client is not configured', async () => {
      vi.spyOn(service, 'ensureClientInitialized').mockReturnValue(false);
      (service as any).client = null;

      const suggestions = await service.generateConversationSuggestions([
        { sender: 'me', text: 'Hello!' },
      ]);
      expect(suggestions).toEqual([]);
    });

    it('should successfully parse valid JSON array of 3 suggestions from client', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify([
          'What is your favorite project so far?',
          'Do you prefer frontend or backend?',
          'Have you tried Next.js with React 19?',
        ]),
      });

      (service as any).client = {
        models: {
          generateContent: mockGenerateContent,
        },
      };
      vi.spyOn(service, 'ensureClientInitialized').mockReturnValue(true);

      const suggestions = await service.generateConversationSuggestions([
        { sender: 'me', text: 'I love coding in TypeScript.' },
        { sender: 'stranger', text: 'Nice, me too!' },
      ]);

      expect(mockGenerateContent).toHaveBeenCalled();
      expect(suggestions).toHaveLength(3);
      expect(suggestions[0]).toBe('What is your favorite project so far?');
    });

    it('should parse JSON array wrapped in markdown code blocks', async () => {
      const rawMarkdown = '```json\n["Topic 1", "Topic 2", "Topic 3"]\n```';
      (service as any).client = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: rawMarkdown }),
        },
      };
      vi.spyOn(service, 'ensureClientInitialized').mockReturnValue(true);

      const suggestions = await service.generateConversationSuggestions([
        { sender: 'me', text: 'Tell me about gaming.' },
      ]);

      expect(suggestions).toEqual(['Topic 1', 'Topic 2', 'Topic 3']);
    });

    it('should throw MALFORMED_RESPONSE if response does not contain exactly 3 valid strings', async () => {
      (service as any).client = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify(['Only one suggestion']),
          }),
        },
      };
      vi.spyOn(service, 'ensureClientInitialized').mockReturnValue(true);

      await expect(
        service.generateConversationSuggestions([{ sender: 'me', text: 'Hi' }]),
      ).rejects.toThrow('MALFORMED_RESPONSE');
    });

    it('should throw RATE_LIMIT when 429 or quota exceeded is returned by client', async () => {
      (service as any).client = {
        models: {
          generateContent: vi.fn().mockRejectedValue({
            status: 429,
            message: 'Resource has been exhausted (rate limit)',
          }),
        },
      };
      vi.spyOn(service, 'ensureClientInitialized').mockReturnValue(true);

      await expect(
        service.generateConversationSuggestions([{ sender: 'me', text: 'Hi' }]),
      ).rejects.toThrow('RATE_LIMIT');
    });

    it('should throw SERVICE_UNAVAILABLE on external API network failures', async () => {
      (service as any).client = {
        models: {
          generateContent: vi.fn().mockRejectedValue(new Error('Connection reset')),
        },
      };
      vi.spyOn(service, 'ensureClientInitialized').mockReturnValue(true);

      await expect(
        service.generateConversationSuggestions([{ sender: 'me', text: 'Hi' }]),
      ).rejects.toThrow('SERVICE_UNAVAILABLE');
    });
  });
});
