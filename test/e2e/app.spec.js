import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('anamnesis_intro_seen', 'true'));
  await page.goto('/');
  await expect(page.locator('#stat-total-count')).not.toHaveText('0');
});
async function seed(page, count = 2) {
  await page.evaluate(async count => {
    const entry = document.querySelector('script[src$="app.js"]').src;
    const db = await import(new URL('./db.js', entry).href);
    const { loadCardsFromDB } = await import(new URL('./js/cards.js', entry).href);
    await db.clearDatabase();
    await db.saveCards(Array.from({ length: count }, (_, index) => ({ id: `e2e-${index}`, front: `Question ${index}`, back: 'Answer', deck: 'Tests', last_modified: 100 })));
    await loadCardsFromDB();
  }, count);
}
async function stored(page) {
  return page.evaluate(async () => {
    const entry = document.querySelector('script[src$="app.js"]').src;
    const db = await import(new URL('./db.js', entry).href);
    return { cards: await db.getCards(), logs: await db.getAllReviewLogs() };
  });
}
async function navigate(page, id) {
  if (id === 'view-import') {
    await page.locator('.app-nav [data-view="view-decks"]').click();
    await page.locator('#view-decks .view-header [data-view="view-import"]').click();
  } else await page.locator(`.app-nav [data-view="${id}"]`).click();
}

test('navigation and quick add work without page errors or horizontal overflow', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await navigate(page, 'view-decks');
  await page.locator('[data-deck-tab="tab-add"]').click();
  await page.locator('#quick-front').fill('Production question');
  await page.locator('#quick-back').fill('Production answer');
  await page.locator('#quick-deck').fill('Production checks');
  await page.locator('#btn-quick-add').click();
  await expect.poll(async () => (await stored(page)).cards.some(card => card.front === 'Production question')).toBe(true);
  for (const id of ['view-analytics', 'view-import', 'view-settings', 'view-review']) { await navigate(page, id); await expect(page.locator('#' + id)).toBeVisible(); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('grading and undo through real controls preserve persisted state', async ({ page }) => {
  await seed(page);
  await page.locator('#btn-start-review').click();
  await expect(page.locator('#subview-study')).toHaveClass(/active/);
  await page.locator('#btn-reveal-answer').click();
  await page.locator('[data-grade="3"]').click();
  await expect.poll(async () => (await stored(page)).logs.length).toBe(1);
  await expect(page.locator('#flashcard')).not.toHaveClass(/flipped/);
  await page.locator('#btn-undo-study').click();
  await expect.poll(async () => (await stored(page)).logs.length).toBe(0);
  expect((await stored(page)).cards.every(card => !card.fsrs_stats)).toBe(true);
});

test('backup export contains review history and modal focus stays contained', async ({ page }) => {
  await seed(page);
  await navigate(page, 'view-settings');
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await page.locator('#btn-create-backup-now').click();
  await expect(page.locator('.backup-item-card')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.locator('.backup-item-card').getByRole('button', { name: 'Export', exact: true }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/anamnesis_backup_.*\.json/);
  const backup = JSON.parse(await readFile(await exported.path(), 'utf8'));
  expect(backup.cards).toHaveLength(2);
  expect(backup.review_logs).toEqual([]);
  await page.locator('.backup-item-card').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('#modal-container [role="dialog"]')).toBeVisible();
  await page.locator('#modal-btn-confirm').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#modal-btn-cancel')).toBeFocused();
  await page.locator('#modal-btn-cancel').click();
});

test('installed release starts offline with its persisted cards', async ({ page, context }) => {
  await seed(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#stat-total-count')).toHaveText('2');
  await page.locator('#btn-start-review').click();
  await expect(page.locator('#subview-study')).toHaveClass(/active/);
});

test('Settings offers keyboard-operated secondary tabs and remembered credentials by default', async ({ page }) => {
  await navigate(page, 'view-settings');
  const general = page.getByRole('tab', { name: 'Preferences', exact: true });
  await expect(general).toHaveAttribute('aria-selected', 'true');
  await general.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Data', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-data')).toBeVisible();
  await expect(page.locator('#settings-general')).toBeHidden();
  await page.getByRole('tab', { name: 'Sync', exact: true }).click();
  await expect(page.locator('#settings-remember-token')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('deck search preserves direct study and gives a useful empty result', async ({ page }) => {
  await seed(page);
  await navigate(page, 'view-decks');
  await expect(page.locator('.simple-deck-row')).toHaveCount(1);
  await page.getByLabel('Find a deck').fill('Missing');
  await expect(page.locator('#simple-deck-list')).toContainText('No matching decks.');
  await page.getByLabel('Find a deck').fill('Tests');
  await expect(page.locator('.simple-deck-row')).toHaveCount(1);
  await page.locator('.deck-study').click();
  await expect(page.locator('#subview-study')).toHaveClass(/active/);
});

test('focused add flow and organization have distinct destinations', async ({ page }) => {
  await navigate(page, 'view-decks');
  await page.getByRole('tab', { name: 'Organize', exact: true }).click();
  await expect(page.locator('#win-explorer')).toBeVisible();
  await page.getByRole('tab', { name: 'Decks', exact: true }).click();
  await expect(page.locator('#win-explorer')).toBeHidden();
  await page.locator('#view-decks .view-header [data-open-add]').click();
  await expect(page.locator('#quick-front')).toBeFocused();
  await expect(page.locator('#decks-tab-bar')).toBeHidden();
  await page.locator('[data-return-decks]').click();
  await expect(page.getByRole('tab', { name: 'Decks', exact: true })).toBeFocused();
});

test('Progress and Import expose one detail panel at a time', async ({ page }) => {
  await navigate(page, 'view-analytics');
  await expect(page.locator('#progress-overview')).toBeVisible();
  await expect(page.locator('#progress-model')).toBeHidden();
  await page.getByRole('tab', { name: 'Model', exact: true }).click();
  await expect(page.locator('#progress-model')).toBeVisible();
  await expect(page.locator('#progress-overview')).toBeHidden();
  await navigate(page, 'view-import');
  await page.getByRole('tab', { name: 'Paste text', exact: true }).click();
  await page.locator('#import-text').fill('Front,Back\nHello,Hola');
  await page.locator('#btn-parse-csv').click();
  await expect(page.locator('#preview-count')).toHaveText('1');
  await page.getByRole('tab', { name: 'Starter deck', exact: true }).click();
  await expect(page.locator('#import-preview-section')).toBeHidden();
});
