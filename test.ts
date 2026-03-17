import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser } from 'puppeteer-core';
puppeteer.use(StealthPlugin());

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  throw new Error('TOKEN is required');
}

const browserWSEndpoint = new URL(
  process.env.BROWSER_WS_ENDPOINT ?? 'ws://localhost:8080/puppeteer'
);
browserWSEndpoint.searchParams.set('token', TOKEN);

const browser: Browser = await puppeteer.connect({
  browserWSEndpoint: browserWSEndpoint.toString(),
});

const page = await browser.newPage();
await page.goto('https://www.google.com');
console.log(await page.title());
await browser.close();