import { test, expect } from '@playwright/test';
import { completeProfileSetup, generateTestUsername } from './helpers/test-utils';

test.describe('F & J. Notifications, Settings & Account Deletion Lifecycle', () => {
  test('should view notification dropdown, open settings, and perform account deletion', async ({ page }) => {
    await page.goto('/');

    const username = await completeProfileSetup(page, { username: generateTestUsername('DelUser') });

    // 1. Notifications Dropdown Toggle
    const notifBtn = page.locator('button[data-notification-trigger="true"]');
    await expect(notifBtn).toBeVisible();
    await notifBtn.click();

    // Verify Notification dropdown opens
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible();

    // Close notifications by clicking the notification trigger button again
    await notifBtn.click();
    await expect(page.getByText('Notifications', { exact: true })).not.toBeVisible({ timeout: 5000 });

    // 2. Open Sidebar Navigation
    await page.getByRole('button', { name: 'Toggle Sidebar Navigation' }).click();

    // Open Settings (the gear icon button in sidebar)
    const settingsBtn = page.locator('aside button[title="Settings"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Verify Application Settings Modal opens
    await expect(page.getByText('Application Settings')).toBeVisible();

    // 3. Initiate Account Deletion
    const deleteAccountTrigger = page.locator('button:has-text("Logout / Delete Account")');
    await expect(deleteAccountTrigger).toBeVisible();
    await deleteAccountTrigger.click();

    // 4. Verify Delete Confirmation Modal opens
    await expect(page.getByText('Delete your account?')).toBeVisible();
    await expect(page.getByText('This action cannot be undone.')).toBeVisible();

    // 5. Confirm Account Deletion
    const confirmDeleteBtn = page.locator('button:has-text("Delete Account")').last();
    await expect(confirmDeleteBtn).toBeVisible();
    await confirmDeleteBtn.click();

    // 6. Verify User is logged out and returned to Create Profile screen
    await expect(page.getByPlaceholder('e.g. Alex_Code')).toBeVisible({ timeout: 15000 });
  });
});
