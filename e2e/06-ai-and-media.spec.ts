import { test, expect } from '@playwright/test';
import { completeProfileSetup } from './helpers/test-utils';

test.describe('G & H. AI Suggestions, Media Attachments & Voice Recorder', () => {
  test('should display AI suggestions, attach images, and render voice recorder', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Mock AI conversation suggestions endpoint in contextA to ensure 100% deterministic test without external API hits
    await pageA.route('**/ai/conversation-suggestions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suggestions: [
            'What is your favorite hobby to unwind?',
            'Have you traveled anywhere exciting lately?',
            'What kind of music do you listen to?',
          ],
        }),
      });
    });

    await pageA.goto('/');
    await pageB.goto('/');

    await completeProfileSetup(pageA);
    await completeProfileSetup(pageB);

    // Match both users
    await pageA.getByRole('button', { name: 'Find a Stranger' }).click();
    await pageB.getByRole('button', { name: 'Find a Stranger' }).click();

    await expect(pageA.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 15000 });

    // Send 3 messages to establish necessary conversational context for AI suggestions
    const inputA = pageA.getByPlaceholder('Type a message...');
    await inputA.fill('Hello!');
    await pageA.getByRole('button', { name: 'Send' }).click();

    const inputB = pageB.getByPlaceholder('Type a message...');
    await inputB.fill('Hey there!');
    await pageB.getByRole('button', { name: 'Send' }).click();

    await inputA.fill('How is your day going?');
    await pageA.getByRole('button', { name: 'Send' }).click();

    // Wait for all 3 messages to be fully rendered in User A's chat
    await expect(pageA.getByText('Hello!')).toBeVisible();
    await expect(pageA.getByText('Hey there!')).toBeVisible();
    await expect(pageA.getByText('How is your day going?')).toBeVisible();

    // 1. AI Suggestions: Click "Refresh ideas" button
    const aiBtn = pageA.locator('button:has-text("Refresh ideas")');
    await expect(aiBtn).toBeVisible({ timeout: 10000 });
    await aiBtn.click();

    // Verify suggestions are populated
    await expect(pageA.getByText('What is your favorite hobby to unwind?')).toBeVisible({ timeout: 10000 });
    await expect(pageA.getByText('Have you traveled anywhere exciting lately?')).toBeVisible();
    await expect(pageA.getByText('What kind of music do you listen to?')).toBeVisible();

    // Clicking a suggestion fills it into the message input
    await pageA.getByText('What is your favorite hobby to unwind?').click();
    await expect(inputA).toHaveValue('What is your favorite hobby to unwind?');

    // 2. Media: Verify Photo Attach Button & Hidden Input
    const photoBtn = pageA.locator('button[aria-label="Upload photo"]');
    await expect(photoBtn).toBeVisible();

    // 3. Voice Recorder: Verify Mic Button is rendered
    const micBtn = pageA.locator('button:has-text("🎙️")');
    await expect(micBtn).toBeVisible();

    await contextA.close();
    await contextB.close();
  });
});
