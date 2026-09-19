import { test, expect } from '@playwright/test';
import { completeProfileSetup } from './helpers/test-utils';

test.describe('I. WebRTC Video Call Flow', () => {
  test('should handle video call request, decline, and accept lifecycle', async ({ browser, browserName }) => {
    // WebKit in automation environment does not provide fake media stream devices / getUserMedia hardware emulation.
    // Documented limitation: getUserMedia is unavailable in Playwright WebKit on Windows CI/local automation.
    test.skip(browserName === 'webkit', 'WebKit automation does not support fake media stream devices or getUserMedia hardware');

    // Both contexts inherit camera/mic fake media devices from playwright.config.ts
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    await completeProfileSetup(pageA);
    await completeProfileSetup(pageB);

    // Match both users
    await pageA.getByRole('button', { name: 'Find a Stranger' }).click();
    await pageB.getByRole('button', { name: 'Find a Stranger' }).click();

    await expect(pageA.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 15000 });
    await expect(pageB.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 15000 });

    // 1. User A initiates video call
    const videoCallBtnA = pageA.locator('button[aria-label="Start video call"]');
    await expect(videoCallBtnA).toBeVisible({ timeout: 10000 });
    await videoCallBtnA.click();

    // User A sees CallingModal
    await expect(pageA.getByText(/Calling/i)).toBeVisible({ timeout: 10000 });

    // User B receives incoming call modal
    await expect(pageB.getByText('Incoming Video Call')).toBeVisible({ timeout: 10000 });

    // 2. Test Decline: User B declines call
    const declineBtn = pageB.locator('button[aria-label="Decline video call"]');
    await expect(declineBtn).toBeVisible();
    await declineBtn.click();

    // Verify incoming call modal closes on User B and Calling modal closes on User A
    await expect(pageB.getByText('Incoming Video Call')).not.toBeVisible({ timeout: 10000 });
    await expect(pageA.getByText(/Calling/i)).not.toBeVisible({ timeout: 10000 });

    // 3. User A initiates video call again
    await videoCallBtnA.click();
    await expect(pageB.getByText('Incoming Video Call')).toBeVisible({ timeout: 10000 });

    // User B accepts call
    const acceptBtn = pageB.locator('button[aria-label="Accept video call"]');
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // 4. Verify VideoCallOverlay appears on both sides
    const endCallBtnA = pageA.locator('button[aria-label="End video call"]');
    await expect(endCallBtnA).toBeVisible({ timeout: 15000 });

    // 5. End Call: User A clicks "End Call"
    await endCallBtnA.click();

    // Verify both return to standard chat view
    await expect(pageA.getByRole('button', { name: 'End Chat' })).toBeVisible({ timeout: 10000 });

    await contextA.close();
    await contextB.close();
  });
});
