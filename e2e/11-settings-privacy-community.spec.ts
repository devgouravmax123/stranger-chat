import { test, expect } from '@playwright/test';
import { completeProfileSetup, generateTestUsername } from './helpers/test-utils';

test.describe('Settings: Privacy Policy and Community Flows', () => {
  test('should open Settings, view Privacy Policy, view Community with Instagram icon, and preserve existing settings navigation', async ({ page }) => {
    await page.goto('/');

    const username = await completeProfileSetup(page, { username: generateTestUsername('SettingsUser') });

    // 1. Open existing vertical-three-lines sliding menu (Sidebar)
    const sidebarToggleBtn = page.getByRole('button', { name: 'Toggle Sidebar Navigation' });
    await expect(sidebarToggleBtn).toBeVisible();
    await sidebarToggleBtn.click();

    // 2. Open existing Settings from sidebar
    const settingsBtn = page.locator('aside button[title="Settings"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Verify Application Settings Modal opens
    const settingsModal = page.getByRole('dialog', { name: /application settings/i });
    await expect(settingsModal).toBeVisible();
    await expect(page.getByText('Application Settings')).toBeVisible();

    // 3. Privacy Policy item is visible inside Settings
    const privacyItemBtn = page.getByRole('button', { name: /privacy policy/i });
    await expect(privacyItemBtn).toBeVisible();

    // 4. Privacy Policy opens when clicked
    await privacyItemBtn.click();
    await expect(page.getByRole('heading', { name: 'Chirp Privacy Policy', level: 1 })).toBeVisible();
    await expect(page.getByText('Chirp allows users to create profiles, discover people, connect based on interests, and communicate with other users.')).toBeVisible();
    await expect(page.getByText('Last updated: September 19, 2026')).toBeVisible();

    // Back button returns to main settings
    const backFromPrivacyBtn = page.getByRole('button', { name: 'Back to Settings' });
    await expect(backFromPrivacyBtn).toBeVisible();
    await backFromPrivacyBtn.click();
    await expect(page.getByText('Application Settings')).toBeVisible();

    // 5. Community item is visible inside Settings
    const communityItemBtn = page.getByRole('button', { name: /community/i });
    await expect(communityItemBtn).toBeVisible();

    // 6. Community opens when clicked
    await communityItemBtn.click();
    await expect(page.getByRole('heading', { name: 'Community', level: 1 })).toBeVisible();
    await expect(page.getByText('Follow Chirp and stay connected with the community.')).toBeVisible();

    // 7. Instagram icon is visible
    const instagramLink = page.getByRole('link', { name: 'Follow Chirp on Instagram' });
    await expect(instagramLink).toBeVisible();

    // 8. Instagram href is exactly https://www.instagram.com/chirp_chat/
    await expect(instagramLink).toHaveAttribute('href', 'https://www.instagram.com/chirp_chat/');

    // 9. Instagram link uses target="_blank" and rel="noopener noreferrer"
    await expect(instagramLink).toHaveAttribute('target', '_blank');
    await expect(instagramLink).toHaveAttribute('rel', 'noopener noreferrer');

    // Back button returns to main settings
    const backFromCommunityBtn = page.getByRole('button', { name: 'Back to Settings' });
    await expect(backFromCommunityBtn).toBeVisible();
    await backFromCommunityBtn.click();
    await expect(page.getByText('Application Settings')).toBeVisible();

    // 10. Existing Settings navigation still works (Close button closes modal)
    const closeBtn = page.getByRole('button', { name: 'Close', exact: true });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(settingsModal).not.toBeVisible();
  });
});
