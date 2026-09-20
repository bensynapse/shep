import { expect, type Page } from '@playwright/test';
import axe, { type AxeResults } from 'axe-core';

export async function expectAccessible(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const engine = (
      window as unknown as {
        axe: { run: (context: Document, options: unknown) => Promise<AxeResults> };
      }
    ).axe;
    const result = await engine.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
    return result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    }));
  });
  expect(violations).toEqual([]);
}
