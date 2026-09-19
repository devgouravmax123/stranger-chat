import { test, expect } from '@playwright/test';

test.describe('A. Application Load & Branding', () => {
  test('should load Chirp homepage without fatal errors and verify branding', async ({ page }) => {
    // Listen for uncaught console errors
    const fatalErrors: string[] = [];
    page.on('pageerror', (err) => fatalErrors.push(err.message));

    await page.goto('/');

    // 1. Title verification
    await expect(page).toHaveTitle(/Chirp/i);

    // 2. Branding verification - "Chirp" should be visible
    const brandElements = page.locator('text=Chirp');
    await expect(brandElements.first()).toBeVisible();

    // 3. Old brand verification - "ChatBuddy" must NOT be anywhere in document
    const bodyContent = await page.content();
    expect(bodyContent).not.toContain('ChatBuddy');
    expect(bodyContent).not.toContain('chatbuddy');
    expect(bodyContent).not.toContain('Chat Buddy');

    // 4. Verify initial screen loads (either Profile Setup or Stranger Chat)
    await expect(
      page.getByRole('heading', { name: 'Create Your Profile' }).or(page.getByRole('heading', { name: 'Stranger Chat' }))
    ).toBeVisible({ timeout: 15000 });

    // 5. No fatal page errors occurred during load
    expect(fatalErrors).toEqual([]);
  });
});
