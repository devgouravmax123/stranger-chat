import { Page, expect } from '@playwright/test';

export function generateTestUsername(prefix = 'User'): string {
  const rand = Math.random().toString(36).substring(2, 6);
  const time = Date.now().toString().slice(-4);
  return `${prefix}_${time}_${rand}`.substring(0, 20);
}

export async function completeProfileSetup(
  page: Page,
  options?: { username?: string; age?: string; gender?: string }
): Promise<string> {
  const username = options?.username || generateTestUsername('E2E');
  const age = options?.age || '25';
  const gender = options?.gender || 'male';

  // Wait for profile setup to be displayed
  await expect(page.getByPlaceholder('e.g. Alex_Code')).toBeVisible({ timeout: 15000 });

  await page.getByPlaceholder('e.g. Alex_Code').fill(username);
  await page.getByPlaceholder('18').fill(age);
  await page.locator('select').first().selectOption(gender);

  // Click Submit
  await page.getByRole('button', { name: 'Enter Chirp' }).click();

  // Verify transition to main screen
  await expect(page.getByRole('heading', { name: 'Stranger Chat' })).toBeVisible({ timeout: 15000 });

  return username;
}
