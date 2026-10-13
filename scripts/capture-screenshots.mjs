// Capture the built application with an isolated, disposable demo library.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const profile = await mkdtemp(path.join(tmpdir(), 'paperread-screenshots-'));
await mkdir('docs/screenshots', { recursive: true });
const app = await electron.launch({
  executablePath: 'release/PaperRead-darwin-arm64/PaperRead.app/Contents/MacOS/PaperRead',
  args: ['--user-data-dir=' + profile],
});
try {
  const win = await app.firstWindow();
  await win.waitForSelector('.pdf-page-wrap canvas');
  await win.getByRole('button', { name: '逐节阅读', exact: true }).click();
  if (await win.locator('.reader-route').getAttribute('open') === null)
    await win.locator('.reader-route > summary').click();
  await win.waitForTimeout(6500);
  await win.screenshot({ path: 'docs/screenshots/reading-light.png' });
  await win.getByRole('button', { name: '逐节阅读', exact: true }).click();
  await win.getByLabel('选择阅读小节').selectOption({ index: 2 });
  await win.getByRole('button', { name: '工作台工具', exact: true }).click();
  await win.getByTitle('切换明暗主题').click();
  await win.waitForTimeout(6500);
  await win.screenshot({ path: 'docs/screenshots/figure-dark.png' });
  await win.getByRole('button', { name: '工作台工具', exact: true }).click();
  await win.getByTitle('切换明暗主题').click();
  await win.getByTitle('专注阅读 · 收起两侧栏').click();
  await win.screenshot({ path: 'docs/screenshots/reading-focus.png' });
  await win.getByTitle('恢复联动布局').click();
  await win.getByRole('button', { name: '设置', exact: true }).click();
  await win.waitForFunction(() => document.querySelector('select[aria-label="Codex OpenAI 模型"]')?.options.length > 1);
  await win.getByLabel('Codex OpenAI 模型').scrollIntoViewIfNeeded();
  await win.getByLabel('Codex 推理强度').scrollIntoViewIfNeeded();
  await win.screenshot({ path: 'docs/screenshots/codex-settings.png' });
  console.log('Saved 4 screenshots using synthetic demo data.');
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
