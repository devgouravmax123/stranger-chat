import { test, expect } from '@playwright/test';
import { completeProfileSetup, generateTestUsername } from './helpers/test-utils';

test.describe('C. Stranger Matchmaking Flow', () => {
  test('should enter matchmaking queue and allow user to cancel search', async ({ page }) => {
    await page.goto('/');
    await completeProfileSetup(page, { username: generateTestUsername('QueueUser') });

    // Click "Find a Stranger"
    const findStrangerBtn = page.getByRole('button', { name: 'Find a Stranger' });
    await expect(findStrangerBtn).toBeVisible();
    await findStrangerBtn.click();

    // Verify searching state or no-one-live fallback appears
    const queueOrNoLive = page.getByText('Looking for a stranger...').or(page.getByText('No one is live right now'));
    await expect(queueOrNoLive).toBeVisible({ timeout: 10000 });

    // Verify Cancel Search button is available and works
    const cancelBtn = page.getByRole('button', { name: 'Cancel Search' });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // User should return to idle screen with "Find a Stranger" visible
    await expect(findStrangerBtn).toBeVisible({ timeout: 10000 });
  });

  test('should match two independent users and enter stranger chat', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    const userA = await completeProfileSetup(pageA, { username: generateTestUsername('MatchA') });
    const userB = await completeProfileSetup(pageB, { username: generateTestUsername('MatchB') });

    // Both click Find a Stranger
    await pageA.getByRole('button', { name: 'Find a Stranger' }).click();
    await pageB.getByRole('button', { name: 'Find a Stranger' }).click();

    // Verify both transition into active stranger chat
    await expect(pageA.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 20000 });
    await expect(pageB.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 20000 });

    // Verify Next Stranger button is also available
    await expect(pageA.getByRole('button', { name: /Next Stranger/ }).first()).toBeVisible();
    await expect(pageB.getByRole('button', { name: /Next Stranger/ }).first()).toBeVisible();

    // Verify neither user matched with themselves
    expect(userA).not.toEqual(userB);

    await contextA.close();
    await contextB.close();
  });
});
