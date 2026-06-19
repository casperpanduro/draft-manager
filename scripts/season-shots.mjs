import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const SB = "http://127.0.0.1:54321";
const MAILPIT = "http://127.0.0.1:54324";
const PUB = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const OUT = "/tmp/shots";
const LEAGUE = process.argv[2];

async function magicLink(email) {
  await fetch(`${SB}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: PUB, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: false }),
  });
  await new Promise((r) => setTimeout(r, 900));
  const list = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  const id = list.messages[0].ID;
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
  const body = msg.HTML || msg.Text || "";
  const m = body.match(/href="([^"]+auth\/confirm[^"]+)"/);
  return m[1].replace(/&amp;/g, "&");
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

const link = await magicLink("gaffer@demo.dev");
await page.goto(link, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const tabs = ["Overview", "My XI", "Transfers", "Table", "Fixtures", "Stats"];
await page.goto(`${BASE}/league/${LEAGUE}/season`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

for (let i = 0; i < tabs.length; i++) {
  await page.getByRole("tab", { name: tabs[i], exact: true }).click();
  await page.waitForTimeout(700);
  const slug = tabs[i].toLowerCase().replace(/\s+/g, "-");
  await page.screenshot({ path: `${OUT}/season-${i + 1}-${slug}.png`, fullPage: true });
}

// Transfers: open the market on a dropped player to show step 2.
await page.getByRole("tab", { name: "Transfers", exact: true }).click();
await page.waitForTimeout(500);
const dropBtns = page.locator("button:has-text('·')");
if (await dropBtns.count()) {
  await dropBtns.first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/season-7-transfer-market.png`, fullPage: true });
}

await browser.close();
console.log("done");
