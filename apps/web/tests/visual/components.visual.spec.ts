import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface StoryEntry {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly name: string;
}

/**
 * Discovered from the real Storybook build output, not hand-listed — a new
 * *.stories.tsx file is covered the next time `build-storybook` + this
 * suite run, with no test file to remember to update.
 */
const indexPath = join(__dirname, '../../storybook-static/index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
  entries: Record<string, StoryEntry>;
};
const stories = Object.values(index.entries).filter((entry) => entry.type === 'story');

const THEMES = ['light', 'dark'] as const;
const DIRECTIONS = ['ltr', 'rtl'] as const;

for (const story of stories) {
  for (const theme of THEMES) {
    for (const direction of DIRECTIONS) {
      test(`${story.title} - ${story.name} - ${theme}/${direction}`, async ({ page }) => {
        await page.goto(
          `/iframe.html?id=${story.id}&globals=theme:${theme};direction:${direction}`,
        );
        const root = page.locator('#storybook-root');
        await root.waitFor({ state: 'visible' });
        // Screenshot the component's own bounding box, not the full page:
        // a full-page screenshot at default viewport size lets a real
        // regression hide under even a strict pixel-ratio tolerance simply
        // because the component is a small fraction of the captured area.
        await expect(root).toHaveScreenshot(`${story.id}--${theme}-${direction}.png`);
      });
    }
  }
}
