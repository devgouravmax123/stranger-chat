import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as fs from 'fs';

test.describe('Phase 10: Automated Accessibility Audit (axe-core)', () => {
  const auditResults: Record<string, any> = {};

  test('Audit: Home / Landing Page (New Visitor)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    auditResults['landing_page'] = {
      violations: accessibilityScanResults.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        nodes: v.nodes.length
      }))
    };

    console.log('Landing page violations:', JSON.stringify(auditResults['landing_page'].violations, null, 2));
  });

  test('Audit: Profile Setup Modal', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const getStartedBtn = page.getByRole('button', { name: /start chatting|get started/i });
    if (await getStartedBtn.isVisible()) {
      await getStartedBtn.click();
    }
    await expect(page.locator('input[placeholder*="username" i], input[placeholder*="Alex" i], input[placeholder*="display name" i]').first()).toBeVisible({ timeout: 5000 });

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    auditResults['profile_setup'] = {
      violations: accessibilityScanResults.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        nodes: v.nodes.length
      }))
    };

    console.log('Profile setup violations:', JSON.stringify(auditResults['profile_setup'].violations, null, 2));
  });

  test('Audit: Main Chat & App Interface', async ({ page }) => {
    // Inject logged in user into localStorage
    const testUser = {
      id: 'a11y-audit-user-' + Date.now(),
      username: 'a11yTester',
      interests: ['Tech', 'Gaming'],
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=a11yTester'
    };

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((u) => {
      localStorage.setItem('chirp_user', JSON.stringify(u));
      localStorage.setItem('chat_user', JSON.stringify(u));
    }, testUser);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    auditResults['main_chat_ui'] = {
      violations: accessibilityScanResults.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        nodes: v.nodes.length
      }))
    };

    console.log('Main chat violations:', JSON.stringify(auditResults['main_chat_ui'].violations, null, 2));
  });

  test('Audit: Discover People & Friends View', async ({ page }) => {
    const testUser = {
      id: 'a11y-audit-user-' + Date.now(),
      username: 'a11yTester',
      interests: ['Tech', 'Gaming'],
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=a11yTester'
    };

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((u) => {
      localStorage.setItem('chirp_user', JSON.stringify(u));
      localStorage.setItem('chat_user', JSON.stringify(u));
    }, testUser);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Open Discover
    const discoverBtn = page.getByRole('button', { name: /discover/i }).first();
    if (await discoverBtn.isVisible()) {
      await discoverBtn.click();
      await page.waitForTimeout(800);
    }

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    auditResults['discover_view'] = {
      violations: accessibilityScanResults.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        nodes: v.nodes.length
      }))
    };

    console.log('Discover view violations:', JSON.stringify(auditResults['discover_view'].violations, null, 2));

    // Save full audit output
    fs.writeFileSync('axe-audit-results.json', JSON.stringify(auditResults, null, 2));
  });
});
