module.exports = async function signIn(page, base) {
  await page.goto(base + 'index.html'); await page.waitForSelector('#kfSignIn');
  await page.fill('#kfsCoName', 'Test Forestry'); await page.fill('#kfsPw', 'secret1'); await page.fill('#kfsName', 'Office PC');
  await page.click('#kfsAdmin'); await page.waitForFunction(() => !!localStorage.kfAdminToken); await page.waitForTimeout(800);
};
