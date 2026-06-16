import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const SB = "http://127.0.0.1:54321";
const MAILPIT = "http://127.0.0.1:54324";
const PUB = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const OUT = "/tmp/shots";

async function magicLink(email) {
  await fetch(`${SB}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: PUB, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: false }),
  });
  // small wait for mail delivery
  await new Promise((r) => setTimeout(r, 800));
  const list = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  const id = list.messages[0].ID;
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
  const body = msg.HTML || msg.Text || "";
  const m = body.match(/href="([^"]+auth\/confirm[^"]+)"/);
  return m[1].replace(/&amp;/g, "&");
}

const leagues = process.argv.slice(2); // [lobbyId, liveId]

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

// Public pages (logged out)
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/1-landing.png` });

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/2-login.png` });

// Log in as the gaffer
const link = await magicLink("gaffer@demo.dev");
await page.goto(link, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/3-dashboard.png`, fullPage: true });

// Competition page (branded skin)
await page.goto(`${BASE}/competition/world-cup`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/3b-competition.png`, fullPage: true });

// Lobby
if (leagues[0]) {
  await page.goto(`${BASE}/league/${leagues[0]}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/4-lobby.png` });
}

// Draft room — scoreboard + players
if (leagues[1]) {
  await page.goto(`${BASE}/league/${leagues[1]}/draft`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/5-draft-players.png` });

  // My XI tab (pitch)
  await page.getByRole("tab", { name: "My XI" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/6-draft-pitch.png` });

  // Board tab
  await page.getByRole("tab", { name: "Board" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/7-draft-board.png` });
}

await browser.close();
console.log("done");
