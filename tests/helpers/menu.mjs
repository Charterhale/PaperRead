// Exercise the visible overflow control before clicking a secondary action.
export async function clickTool(page, title) {
  const item = page.getByTitle(title, { exact: true });
  if (!await item.isVisible()) {
    await item.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," action-menu ")][1]').locator(':scope > button').click();
  }
  await item.click();
}
