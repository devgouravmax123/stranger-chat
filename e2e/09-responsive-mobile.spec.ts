import { test, expect } from '@playwright/test';
import { completeProfileSetup } from './helpers/test-utils';

test.describe('Responsive & Mobile Viewport Checks', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('should render properly and handle navigation on a mobile viewport', async ({ page }) => {
    await page.goto('/');

    await completeProfileSetup(page);

    // Verify main screen renders without fatal error
    await expect(page.getByRole('heading', { name: 'Stranger Chat' })).toBeVisible({ timeout: 15000 });

    // Verify hamburger button works to open mobile sidebar
    const hamburgerBtn = page.getByRole('button', { name: 'Toggle Sidebar Navigation' });
    await expect(hamburgerBtn).toBeVisible();
    await hamburgerBtn.click();

    // Verify sidebar translates into view
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Close sidebar via Chat tab
    await page.locator('aside button[title="Stranger Chat"]').click();

    // Verify "Find a Stranger" button is visible and clickable on mobile
    const findStrangerBtn = page.getByRole('button', { name: 'Find a Stranger' });
    await expect(findStrangerBtn).toBeVisible();
  });
});
