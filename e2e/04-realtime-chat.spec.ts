import { test, expect } from '@playwright/test';
import { completeProfileSetup } from './helpers/test-utils';

test.describe('D. Realtime Chat & Message Flow', () => {
  test('should match two users, exchange messages, show typing indicators, and handle chat exit', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    await completeProfileSetup(pageA);
    await completeProfileSetup(pageB);

    // Both enter matchmaking
    await pageA.getByRole('button', { name: 'Find a Stranger' }).click();
    await pageB.getByRole('button', { name: 'Find a Stranger' }).click();

    // Wait for stranger chat view
    await expect(pageA.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 15000 });
    await expect(pageB.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 15000 });

    // 1. Typing indicator test: User A types in input
    const inputA = pageA.getByPlaceholder('Type a message...');
    await inputA.focus();
    await inputA.fill('Hello User B!');

    // User B should see "Stranger is typing..."
    await expect(pageB.locator('text=Stranger is typing...')).toBeVisible({ timeout: 10000 });

    // 2. User A sends message
    await pageA.getByRole('button', { name: 'Send' }).click();

    // Verify User A sees own message
    await expect(pageA.getByText('Hello User B!')).toBeVisible({ timeout: 10000 });

    // Verify User B receives it
    await expect(pageB.getByText('Hello User B!')).toBeVisible({ timeout: 10000 });

    // 3. User B replies
    const inputB = pageB.getByPlaceholder('Type a message...');
    await inputB.fill('Hi User A, nice to meet you!');
    await pageB.getByRole('button', { name: 'Send' }).click();

    // Verify both see reply
    await expect(pageA.getByText('Hi User A, nice to meet you!')).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByText('Hi User A, nice to meet you!')).toBeVisible({ timeout: 10000 });

    // 4. End Chat flow: User A clicks "End Chat"
    await pageA.getByRole('button', { name: 'End Chat' }).click();

    // User A returns to matchmaking screen
    await expect(pageA.getByRole('button', { name: 'Find a Stranger' })).toBeVisible({ timeout: 10000 });

    // User B sees stranger disconnected status
    await expect(pageB.locator('text=Stranger disconnected')).toBeVisible({ timeout: 10000 });

    await contextA.close();
    await contextB.close();
  });
});
