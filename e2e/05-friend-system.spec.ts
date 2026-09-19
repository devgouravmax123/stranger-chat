import { test, expect } from '@playwright/test';
import { completeProfileSetup, generateTestUsername } from './helpers/test-utils';

test.describe('E. Friend System Flow', () => {
  test('should search user in Discover, send friend request, accept in friends panel, and open private chat', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    const usernameA = await completeProfileSetup(pageA, { username: generateTestUsername('Alice') });
    const usernameB = await completeProfileSetup(pageB, { username: generateTestUsername('Bob') });

    // 1. User A opens Sidebar and navigates to Discover People
    await pageA.getByRole('button', { name: 'Toggle Sidebar Navigation' }).click();
    await pageA.locator('aside button:has-text("Discover")').click();

    // On mobile viewports, toggle sidebar closed via hamburger so full main view is active
    const mobileBackdropA = pageA.locator('div.fixed.inset-0.z-40.bg-black\\/60');
    if (await mobileBackdropA.isVisible().catch(() => false)) {
      await pageA.getByRole('button', { name: 'Toggle Sidebar Navigation' }).click();
    }

    // Verify Discover People screen is displayed
    await expect(pageA.getByRole('heading', { name: 'Discover People' })).toBeVisible({ timeout: 10000 });

    // 2. Search for User B in Discover directory
    const searchInput = pageA.getByPlaceholder('Search by username...');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill(usernameB);

    // User B should appear in results
    await expect(pageA.getByText(usernameB)).toBeVisible({ timeout: 10000 });

    // 3. Send Friend Request
    const addFriendBtn = pageA.locator('button:has-text("Add Friend")').first();
    await expect(addFriendBtn).toBeVisible();
    await addFriendBtn.click();

    // Verify status updates to "Request Sent"
    await expect(pageA.locator('button:has-text("Request Sent")').first()).toBeVisible({ timeout: 10000 });

    // 4. User B opens Sidebar and goes to Friends panel
    await pageB.getByRole('button', { name: 'Toggle Sidebar Navigation' }).click();
    await pageB.locator('aside button:has-text("Friends")').click();

    // On mobile viewports, toggle sidebar closed via hamburger
    const mobileBackdropB = pageB.locator('div.fixed.inset-0.z-40.bg-black\\/60');
    if (await mobileBackdropB.isVisible().catch(() => false)) {
      await pageB.getByRole('button', { name: 'Toggle Sidebar Navigation' }).click();
    }

    // Verify Friends & Connections panel opens
    await expect(pageB.getByRole('heading', { name: 'Friends & Connections' })).toBeVisible({ timeout: 10000 });

    // User A should be listed under pending requests
    await expect(pageB.getByText(usernameA, { exact: true })).toBeVisible({ timeout: 10000 });

    // User B clicks Accept
    const acceptBtn = pageB.getByRole('button', { name: 'Accept' }).first();
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // 5. Verify friendship appears in "Your Friends" and private chat can be opened
    const chatBtn = pageB.locator('section:has-text("Your Friends") button:has-text("Chat")');
    await expect(chatBtn).toBeVisible({ timeout: 10000 });
    await chatBtn.click();

    // Verify friend chat message input is visible
    const msgInput = pageB.getByPlaceholder('Type a message...');
    await expect(msgInput).toBeVisible({ timeout: 10000 });

    // Send a message
    await msgInput.fill('Hey friend! Glad we connected.');
    await pageB.getByRole('button', { name: 'Send' }).click();

    await expect(pageB.getByText('Hey friend! Glad we connected.')).toBeVisible({ timeout: 10000 });

    await contextA.close();
    await contextB.close();
  });
});
