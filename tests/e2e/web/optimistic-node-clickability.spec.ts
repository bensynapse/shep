import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openShepDb } from './helpers/collaboration-flag';
import { removeDirWithRetry } from '../../helpers/remove-dir.helper';

const REPO_ID = `e2e-clickability-${randomUUID()}`;
const FEATURE_ID = `${REPO_ID}-feature`;
let repoPath: string;

test.beforeAll(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'shep-clickability-'));
  const db = openShepDb();
  try {
    const now = Date.now();
    db.prepare(
      'INSERT INTO repositories (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(REPO_ID, 'Clickability fixture', repoPath, now, now);
    db.prepare(
      `INSERT INTO features
      (id, name, slug, description, user_query, repository_path, repository_id, branch,
       lifecycle, messages, related_artifacts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      FEATURE_ID,
      'Existing feature',
      'existing-feature',
      'Clickability fixture',
      'Fixture',
      repoPath,
      REPO_ID,
      'feat/clickability',
      'Implementation',
      '[]',
      '[]',
      now,
      now
    );
  } finally {
    db.close();
  }
});

test.afterAll(() => {
  const db = openShepDb();
  try {
    db.prepare('DELETE FROM features WHERE id = ?').run(FEATURE_ID);
    db.prepare('DELETE FROM repositories WHERE id = ?').run(REPO_ID);
  } finally {
    db.close();
    if (repoPath) removeDirWithRetry(repoPath);
  }
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('shep:collaboration-onboarding-dismissed', '1');
  });
});

test.describe('Feature node clickability — drawer opens after feature creation', () => {
  test('clicking existing feature nodes opens the detail drawer after submitting the create form', async ({
    page,
  }) => {
    // Mock the repositories API to provide at least one repo
    await page.route('**/api/repositories', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: REPO_ID,
            path: repoPath,
            name: 'Test Repo',
          },
        ]),
      })
    );

    // Intercept createFeature server action to delay it (simulate slow creation)
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action']) {
        const body = request.postData();
        if (body?.includes('E2E Optimistic Clickability Test')) {
          // Delay for 10 seconds — long enough to click other nodes
          await new Promise((resolve) => setTimeout(resolve, 10000));
          await route.fulfill({
            status: 200,
            contentType: 'text/x-component',
            body: '1:{"error":"Test intercepted"}\n',
          });
          return;
        }
      }
      await route.fallback();
    });

    // Navigate to control center
    await page.goto('/control-center');

    // Check if any feature nodes exist
    const featureCards = page.locator('[data-testid="feature-node-card"]');
    await expect(featureCards.first()).toBeVisible({ timeout: 10000 });

    // Remember the name of the first existing feature node for drawer verification
    const firstNodeHeading = page
      .locator('[data-testid="feature-node-card"]:not([aria-busy="true"]) h3')
      .first();
    const firstNodeName = await firstNodeHeading.textContent();

    // Step 1: Open the create-feature drawer by navigating to /create with repo selected
    await page.goto(`/create?repo=${encodeURIComponent(repoPath)}`);

    // Wait for the create drawer heading
    await expect(page.getByRole('heading', { name: 'NEW FEATURE' })).toBeVisible({
      timeout: 15000,
    });

    // Step 2: Fill the feature description and submit
    const descriptionInput = page.getByPlaceholder(
      'e.g. Add GitHub OAuth login with callback handling and token refresh...'
    );
    await descriptionInput.fill('E2E Optimistic Clickability Test');

    const submitButton = page.getByRole('button', { name: '+ Create Feature' });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Step 3: Drawer should close (router.push('/') fires immediately on submit)
    await expect(page.getByRole('heading', { name: 'NEW FEATURE' })).not.toBeVisible({
      timeout: 5000,
    });

    // Step 4: While the server action is still in-flight, click on an existing feature node
    const clickableNode = page
      .locator('[data-testid="feature-node-card"]:not([aria-busy="true"])')
      .first();
    await expect(clickableNode).toBeVisible();
    await clickableNode.click();

    // Step 5: Verify the feature detail drawer opens for the clicked node
    const drawerHeader = page.locator('[data-testid="feature-drawer-header"]');
    await expect(drawerHeader).toBeVisible({ timeout: 5000 });

    // The drawer should show the name of the clicked feature
    if (firstNodeName) {
      await expect(drawerHeader).toContainText(firstNodeName);
    }

    // Step 6: Close the drawer by pressing Escape
    await page.keyboard.press('Escape');
    await expect(drawerHeader).not.toBeVisible({ timeout: 3000 });

    // Step 7: Click a different existing node (if available) to verify multiple clicks work
    const secondClickableNode = page
      .locator('[data-testid="feature-node-card"]:not([aria-busy="true"])')
      .nth(1);

    if ((await secondClickableNode.count()) > 0) {
      await secondClickableNode.click();

      // Drawer should open again for the second node
      await expect(drawerHeader).toBeVisible({ timeout: 5000 });

      // Close again
      await page.keyboard.press('Escape');
      await expect(drawerHeader).not.toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('All feature nodes open a drawer on click', () => {
  test('clicking each non-creating feature node opens some drawer', async ({ page }) => {
    // Navigate to control center
    await page.goto('/control-center');

    // Check if any feature nodes exist (use isVisible with short timeout to avoid blocking)
    const featureCards = page.locator('[data-testid="feature-node-card"]');
    await expect(featureCards.first()).toBeVisible({ timeout: 10000 });

    // Get all non-creating feature nodes
    const clickableNodes = page.locator(
      '[data-testid="feature-node-card"]:not([aria-busy="true"])'
    );
    const clickableCount = await clickableNodes.count();
    expect(clickableCount).toBeGreaterThan(0);

    const drawerHeader = page.locator('[data-testid="feature-drawer-header"]');

    // Click each feature node and verify a drawer opens
    for (let i = 0; i < clickableCount; i++) {
      const node = clickableNodes.nth(i);
      const nodeName = await node.locator('h3').textContent();

      // Click the feature node
      await node.click();

      // Verify some drawer opens (either basic FeatureDrawer or specialized ReviewDrawerShell)
      await expect(drawerHeader).toBeVisible({
        timeout: 5000,
      });

      // Verify the drawer shows the correct feature name
      if (nodeName) {
        await expect(drawerHeader).toContainText(nodeName);
      }

      // Close the drawer before clicking the next node
      await page.keyboard.press('Escape');
      await expect(drawerHeader).not.toBeVisible({ timeout: 3000 });
    }
  });
});
