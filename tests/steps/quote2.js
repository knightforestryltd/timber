const signIn = require('./office-signin');
module.exports = async ({ page, base, shot }) => {
  await signIn(page, base);
  await page.goto(base + 'index.html'); await page.waitForTimeout(1500);
  await page.fill('#customerName', 'Busy Bob'); await page.fill('#addressInput', '53.41, -113.31');
  await page.click('#btnCalculate'); await page.waitForTimeout(3000);
  console.log(await page.evaluate(() => document.getElementById('results').innerText.slice(0, 600)));
};
