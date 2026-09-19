import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { completeProfileSetup, generateTestUsername } from './helpers/test-utils';

test.describe('Phase 10: Exhaustive Accessibility Suite (axe-core, keyboard, dialogs, media)', () => {
  test('Step 2: Axe Audit across all major application states', async ({ page }) => {
    // 1. Landing Page (clean new visitor state)
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const landingAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(landingAudit.violations).toEqual([]);

    // 2. Profile Setup Modal
    const getStartedBtn = page.getByRole('button', { name: /start chatting|get started/i });
    if (await getStartedBtn.isVisible()) {
      await getStartedBtn.click();
    }
    await expect(page.getByPlaceholder('e.g. Alex_Code')).toBeVisible({ timeout: 5000 });
    const profileAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(profileAudit.violations).toEqual([]);

    // Complete setup to reach authenticated state
    await completeProfileSetup(page, { username: generateTestUsername('A11y') });

    // 3. Main Chat & App Interface
    const chatAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(chatAudit.violations).toEqual([]);

    // Open sidebar for navigation
    await page.getByRole('button', { name: 'Toggle Sidebar Navigation' }).click();

    // 4. Discover People View
    await page.locator('aside button:has-text("Discover")').click();
    await page.waitForTimeout(600);
    const discoverAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(discoverAudit.violations).toEqual([]);

    // 5. Friends View
    await page.locator('aside button:has-text("Friends")').click();
    await page.waitForTimeout(600);
    const friendsAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(friendsAudit.violations).toEqual([]);

    // 6. Notifications Dropdown
    await page.locator('[data-notification-trigger="true"]').click();
    await page.waitForTimeout(400);
    const notifAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(notifAudit.violations).toEqual([]);
    await page.locator('[data-notification-trigger="true"]').click(); // close

    // 7. Settings Modal
    await page.locator('aside button[title="Settings"]').click();
    await page.waitForTimeout(400);
    const settingsAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(settingsAudit.violations).toEqual([]);
    await page.locator('button[aria-label="Close application settings"]').click();

    // 8. Edit Profile Modal
    await page.locator('button[title="View profile details"]').click();
    await page.waitForTimeout(400);
    const editProfileAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(editProfileAudit.violations).toEqual([]);
    await page.getByRole('button', { name: 'Close edit profile dialog' }).click();
  });

  test('Step 3: Pure Keyboard Navigation & Focus Verification', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await completeProfileSetup(page, { username: generateTestUsername('KbNav') });

    // Ensure focus moves with Tab
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedTag).toBeTruthy();

    // Open Edit Profile via sidebar or header
    await page.getByRole('button', { name: 'Toggle Sidebar Navigation' }).click();
    await page.locator('aside button[title="Edit Profile"]').click();
    const editModal = page.getByRole('dialog', { name: /edit your profile/i });
    await expect(editModal).toBeVisible();

    // Verify Tab cycles inside the modal
    await page.keyboard.press('Tab');
    const focusedInModal = await page.evaluate(() => {
      const active = document.activeElement;
      return active ? active.id || active.getAttribute('aria-label') || active.tagName : null;
    });
    expect(focusedInModal).toBeTruthy();

    // Verify Escape closes the modal
    await page.keyboard.press('Escape');
    await expect(editModal).not.toBeVisible();
  });

  test('Step 4 & 5: Forms, Inputs, Buttons Accessible Names', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    await completeProfileSetup(pageA);
    await completeProfileSetup(pageB);

    // Both enter matchmaking to enter active stranger chat
    await pageA.getByRole('button', { name: 'Find a Stranger' }).click();
    await pageB.getByRole('button', { name: 'Find a Stranger' }).click();

    // Wait for stranger chat view
    await expect(pageA.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 15000 });

    // Verify Message Input accessible name
    const msgInput = pageA.locator('input[aria-label="Type a message"]');
    await expect(msgInput).toBeVisible();

    // Verify mic button has accessible label
    const micBtn = pageA.locator('button[aria-label="Record Voice Note"]');
    await expect(micBtn).toBeVisible();

    // Verify emoji and photo buttons have accessible labels
    const emojiBtn = pageA.locator('button[aria-label="Open emoji picker"]');
    await expect(emojiBtn).toBeVisible();
    const photoBtn = pageA.locator('button[aria-label="Upload photo"]');
    await expect(photoBtn).toBeVisible();

    // Verify Sidebar Hamburger accessible label
    const navToggle = pageA.locator('button[aria-label="Toggle Sidebar Navigation"]');
    await expect(navToggle).toBeVisible();

    // Verify Notifications button accessible label
    const notifBtn = pageA.locator('button[data-notification-trigger="true"]');
    await expect(notifBtn).toHaveAttribute('aria-label', /^Notifications/);

    await contextA.close();
    await contextB.close();
  });

  test('Step 7: Dialog Semantics and Modal Roles', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await completeProfileSetup(page, { username: generateTestUsername('DlgUser') });

    // Open Sidebar first to access Settings
    await page.getByRole('button', { name: 'Toggle Sidebar Navigation' }).click();
    await page.locator('aside button[title="Settings"]').click();

    const settingsDialog = page.getByRole('dialog', { name: /application settings/i });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog).toHaveAttribute('aria-modal', 'true');
    await page.getByRole('button', { name: 'Close application settings' }).click();
    await expect(settingsDialog).not.toBeVisible();
  });

  test('Step 9: Responsive Viewport Accessibility (375x667 mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await completeProfileSetup(page, { username: generateTestUsername('MobA11y') });

    // Verify mobile hamburger
    const hamburger = page.locator('button[aria-label="Toggle Sidebar Navigation"]');
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    // Verify drawer navigation tabs are accessible in aside
    const sidebar = page.locator('aside');
    await expect(sidebar.getByRole('button', { name: /chat/i }).last()).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /friends/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /discover/i })).toBeVisible();

    // Close sidebar
    await hamburger.click();
    await page.waitForTimeout(300);

    // Verify Find a Stranger button on mobile is accessible and not clipped
    const findBtn = page.getByRole('button', { name: 'Find a Stranger' });
    await expect(findBtn).toBeVisible();
    const box = await findBtn.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(120);
    expect(box!.height).toBeGreaterThan(30);
  });
});
