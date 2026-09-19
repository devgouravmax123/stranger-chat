import { test, expect } from '@playwright/test';
import { generateTestUsername } from './helpers/test-utils';

test.describe('B. Profile Creation & Validation Flow', () => {
  test('should validate invalid input and successfully create profile with valid data', async ({ page }) => {
    await page.goto('/');

    // Ensure we are on profile setup (if already completed, clear sessionStorage and reload)
    const isProfileSetup = await page.getByPlaceholder('e.g. Alex_Code').isVisible({ timeout: 5000 }).catch(() => false);
    if (!isProfileSetup) {
      await page.evaluate(() => {
        sessionStorage.clear();
        localStorage.clear();
      });
      await page.reload();
    }

    const usernameInput = page.getByPlaceholder('e.g. Alex_Code');
    const ageInput = page.getByPlaceholder('18');
    const genderSelect = page.locator('select').first();
    const submitBtn = page.getByRole('button', { name: 'Enter Chirp' });

    await expect(usernameInput).toBeVisible({ timeout: 15000 });

    // Test 1: Empty form submission validation
    await submitBtn.click();
    await expect(page.locator('text=Please enter a username.')).toBeVisible();

    // Test 2: Username too short (<3 chars)
    await usernameInput.fill('ab');
    await submitBtn.click();
    await expect(page.locator('text=Username must be at least 3 characters.')).toBeVisible();

    // Test 3: Invalid age (<13)
    const validUsername = generateTestUsername('Prof');
    await usernameInput.fill(validUsername);
    await ageInput.fill('10');
    await submitBtn.click();
    await expect(page.locator('text=Please enter a valid age between 13 and 100.')).toBeVisible();

    // Test 4: Missing gender
    await ageInput.fill('22');
    await submitBtn.click();
    await expect(page.locator('text=Please select your gender.')).toBeVisible();

    // Test 5: Valid profile submission
    await genderSelect.selectOption('female');
    await page.getByRole('button', { name: '🐱' }).click();
    await submitBtn.click();

    // Verify successful creation and landing on Stranger Chat screen
    await expect(page.getByRole('heading', { name: 'Stranger Chat' })).toBeVisible({ timeout: 15000 });

    // Verify created username or avatar reflected in UI (e.g. in AppHeader profile button)
    const profileBtn = page.locator('button[title="View profile details"]');
    await expect(profileBtn).toBeVisible();
    await expect(profileBtn).toContainText(validUsername);
  });

  test('should update preferences from main screen, top-nav profile, and sidebar menu', async ({ page }) => {
    await page.goto('/');

    const isProfileSetup = await page.getByPlaceholder('e.g. Alex_Code').isVisible({ timeout: 5000 }).catch(() => false);
    if (!isProfileSetup) {
      await page.evaluate(() => {
        sessionStorage.clear();
        localStorage.clear();
      });
      await page.reload();
    }

    const validUsername = generateTestUsername('Pref');
    await page.getByPlaceholder('e.g. Alex_Code').fill(validUsername);
    await page.getByPlaceholder('18').fill('24');
    await page.locator('select').first().selectOption('male');
    await page.getByRole('button', { name: '🐱' }).click();
    await page.getByRole('button', { name: 'Enter Chirp' }).click();

    await expect(page.getByRole('heading', { name: 'Stranger Chat' })).toBeVisible({ timeout: 15000 });

    // 1. MAIN SCREEN: Change Language, Interest, Goal and click Save Preferences
    await page.locator('select#pref-language').selectOption('Spanish');
    await page.getByRole('button', { name: '#Gaming' }).click();
    await page.locator('select#pref-goal').selectOption('friendship');

    const savePreferencesBtn = page.getByRole('button', { name: /Save Preferences/i });
    await expect(savePreferencesBtn).toBeVisible();
    await savePreferencesBtn.click();

    // Confirm success notification appears and NO failure message
    await expect(page.locator('text=Match preferences saved!')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Failed to save preferences.')).not.toBeVisible();

    // Verify persisted on reload
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Stranger Chat' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('select#pref-language')).toHaveValue('Spanish');
    await expect(page.locator('select#pref-goal')).toHaveValue('friendship');

    // 2. TOP-NAV PROFILE: Click avatar/username button to open Edit Profile modal
    const profileBtn = page.locator('button[title="View profile details"]');
    await expect(profileBtn).toBeVisible();
    await profileBtn.click();

    const editProfileModalTop = page.getByRole('dialog', { name: 'Edit Your Profile' });
    await expect(editProfileModalTop).toBeVisible({ timeout: 5000 });
    await expect(editProfileModalTop.locator('select#edit-profile-language')).toHaveValue('Spanish');
    await editProfileModalTop.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.locator('text=Profile updated successfully!').first()).toBeVisible({ timeout: 10000 });
    await expect(editProfileModalTop).not.toBeVisible();

    // 3. THREE-LINES SLIDING MENU: Open sidebar, click Edit Preferences, change & save
    const sidebarToggle = page.getByRole('button', { name: 'Toggle Sidebar Navigation' });
    await sidebarToggle.click();

    const editPreferencesBtn = page.locator('button[title="Edit Preferences"]');
    await expect(editPreferencesBtn).toBeVisible();
    await editPreferencesBtn.click();

    const editProfileModal = page.getByRole('dialog', { name: 'Edit Your Profile' });
    await expect(editProfileModal).toBeVisible({ timeout: 5000 });

    await page.locator('select#edit-profile-language').selectOption('Hindi');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.locator('text=Profile updated successfully!').first()).toBeVisible({ timeout: 10000 });
    await expect(editProfileModal).not.toBeVisible();

    // Confirm main screen language reflects the update
    await expect(page.locator('select#pref-language')).toHaveValue('Hindi');
  });
});
