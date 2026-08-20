import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  expireChampionship,
  forceActiveMiniGameToStopBar,
  provisionFinalTie,
  provisionVisiblePointCards,
} from "./local-provisioning";

type MatchClients = {
  hostContext: BrowserContext;
  guestContext: BrowserContext;
  host: Page;
  guest: Page;
  roomId: string;
};

async function enterPointDecisions(clients: MatchClients) {
  await clients.host.getByRole("button", { name: "Skip this round" }).click();
  await clients.guest.getByRole("button", { name: "Skip this round" }).click();
  await expect(clients.host.getByText("YOUR PRIVATE POINT CARD")).toBeVisible();
  await expect(
    clients.guest.getByText("YOUR PRIVATE POINT CARD"),
  ).toBeVisible();
  provisionVisiblePointCards(clients.roomId);
  await expect(clients.host.locator(".point-card-value strong")).toHaveText(
    "100",
  );
  await expect(clients.guest.locator(".point-card-value strong")).toHaveText(
    "1,000",
  );
  await expect(clients.host.locator(".point-card-value strong")).toHaveCount(1);
  await expect(clients.guest.locator(".point-card-value strong")).toHaveCount(
    1,
  );
}

async function activeTurn(clients: MatchClients) {
  if (await clients.host.getByText("YOUR TURN", { exact: true }).count()) {
    return { active: clients.host, other: clients.guest };
  }
  await expect(
    clients.guest.getByText("YOUR TURN", { exact: true }),
  ).toBeVisible();
  return { active: clients.guest, other: clients.host };
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}

async function createStartedTwoClientMatch(
  browser: Browser,
  names: [string, string],
): Promise<MatchClients> {
  const hostContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const guestContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto("/create");
  await expect(host.getByRole("button", { name: "Create room" })).toBeEnabled();
  await host.getByLabel("Your display name").fill(names[0]);
  await host.getByLabel("Max players").selectOption("2");
  await host.getByRole("radio", { name: /6 rounds/i }).check();
  await expect(host.getByLabel("Your display name")).toHaveValue(names[0]);
  await expect(host.getByLabel("Max players")).toHaveValue("2");
  await host.getByRole("button", { name: "Create room" }).click();
  await expect(host).toHaveURL(/\/lobby\?room=/);
  const hostUrl = new URL(host.url());
  const roomId = hostUrl.searchParams.get("room");
  if (!roomId)
    throw new Error("Created lobby did not expose its room identifier.");
  const roomCode = (
    await host.locator(".room-code strong").textContent()
  )?.trim();
  if (!roomCode) throw new Error("Created lobby did not expose its room code.");

  await guest.goto("/join");
  await expect(guest.getByRole("button", { name: "Enter room" })).toBeEnabled();
  await guest.getByLabel("Room code").fill(roomCode);
  await guest.getByLabel("Your display name").fill(names[1]);
  await expect(guest.getByLabel("Room code")).toHaveValue(roomCode);
  await guest.getByRole("button", { name: "Enter room" }).click();
  await expect(guest).toHaveURL(new RegExp(`/lobby\\?room=${roomId}`));
  await guest.getByRole("button", { name: "Mark as ready" }).click();
  await expect(
    guest.getByRole("button", { name: /you’re ready/i }),
  ).toBeVisible();
  await expect(host.getByRole("button", { name: "Start game" })).toBeEnabled();

  await expectNoSeriousAxeViolations(host);
  await expectNoSeriousAxeViolations(guest);
  await host.getByRole("button", { name: "Start game" }).click();
  await expect(host).toHaveURL(new RegExp(`/game\\?room=${roomId}`));
  await expect(guest).toHaveURL(new RegExp(`/game\\?room=${roomId}`));
  await expect(
    host.getByRole("heading", {
      name: "Draw now—or keep your round predictable.",
    }),
  ).toBeVisible();
  await expect(
    guest.getByRole("heading", {
      name: "Draw now—or keep your round predictable.",
    }),
  ).toBeVisible();

  return { hostContext, guestContext, host, guest, roomId };
}

test.describe("Milestone 6 local multiplayer", () => {
  test("two contexts recover, resolve a championship, share, and enter one rematch lobby", async ({
    browser,
  }) => {
    const clients = await createStartedTwoClientMatch(browser, [
      "Playwright Host",
      "Playwright Guest",
    ]);
    const { host, guest, hostContext, guestContext, roomId } = clients;

    await enterPointDecisions(clients);
    await host.getByLabel("Challenge opponent").selectOption({ index: 1 });
    host.once("dialog", (dialog) => dialog.accept());
    await host.getByRole("button", { name: "Queue challenge" }).click();
    await expect(host.getByText(/challenge queued/i)).toBeVisible();

    const { active } = await activeTurn(clients);
    await active
      .getByLabel("Challenge an unresolved player")
      .selectOption({ index: 1 });
    active.once("dialog", (dialog) => dialog.accept());
    await active.getByRole("button", { name: "Challenge" }).click();
    await expect(host.getByText("MINI-GAME RESOLUTION")).toBeVisible();
    await expect(guest.getByText("MINI-GAME RESOLUTION")).toBeVisible();
    forceActiveMiniGameToStopBar(roomId);
    await expect(host.getByRole("button", { name: "STOP" })).toBeVisible();
    await expect(guest.getByRole("button", { name: "STOP" })).toBeVisible();
    await host.getByRole("button", { name: "STOP" }).click();
    await guest.waitForTimeout(250);
    await guest.getByRole("button", { name: "STOP" }).click();
    await expect(host.locator(".game-round-label")).toContainText("2 / 6");

    provisionFinalTie(roomId);
    await expect(
      host.getByRole("heading", { name: "ONE LAST STOP." }),
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: "ONE LAST STOP." }),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(host);

    await host.getByRole("button", { name: "STOP" }).focus();
    await host.keyboard.press("Enter");
    await expect(
      host.getByRole("heading", { name: "Your result is locked." }),
    ).toBeVisible();

    await hostContext.setOffline(true);
    await hostContext.setOffline(false);
    await host.reload();
    await expect(
      host.getByRole("heading", { name: "Your result is locked." }),
    ).toBeVisible();

    await guest.waitForTimeout(450);
    await guest.getByRole("button", { name: "STOP" }).focus();
    await guest.keyboard.press("Space");
    await expect(host.getByText("OFFICIAL RESULT")).toBeVisible();
    await expect(guest.getByText("OFFICIAL RESULT")).toBeVisible();
    await expect(host.getByText("OFFICIAL RESULT")).toHaveCount(1);
    await expect(host.getByText(/championship decided by/i)).toBeVisible();
    await expect(host.getByRole("button", { name: "Rematch" })).toBeVisible();
    await expectNoSeriousAxeViolations(host);

    await host.screenshot({
      path: "docs/screenshots/milestone-6-final-results.png",
      fullPage: true,
    });
    await host.getByRole("button", { name: "Share result" }).click();
    await expect(
      host.getByText("Share summary copied to your clipboard."),
    ).toBeVisible();
    const shared = await host.evaluate(() => navigator.clipboard.readText());
    expect(shared).toContain("ScoreUp champion:");
    expect(shared).toContain("Playwright Host");
    expect(shared).toContain("Playwright Guest");

    const stale = await hostContext.newPage();
    await stale.goto(`/game?room=${roomId}`);
    await expect(stale.getByText("OFFICIAL RESULT")).toBeVisible();
    await host.getByRole("button", { name: "Rematch" }).click();
    await expect(host).toHaveURL(/\/lobby\?room=/);
    const rematchId = new URL(host.url()).searchParams.get("room");
    expect(rematchId).toBeTruthy();
    expect(rematchId).not.toBe(roomId);
    await guest.getByRole("button", { name: "Rematch" }).click();
    await expect(guest).toHaveURL(new RegExp(`/lobby\\?room=${rematchId}`));
    await expect(host.getByText("Playwright Guest")).toBeVisible();
    await expect(host.getByText("Not ready")).toHaveCount(2);
    await expect(host.getByText("30 sec")).toBeVisible();
    await expect(stale.getByText("OFFICIAL RESULT")).toBeVisible();
    await expect(stale.getByRole("button", { name: /lock in/i })).toHaveCount(
      0,
    );
    const anonymousSession = await stale.evaluate(() =>
      localStorage.getItem("scoreup-anonymous-session"),
    );
    await stale.getByRole("button", { name: "Return home" }).click();
    await expect(stale).toHaveURL("/");
    expect(
      await stale.evaluate(() =>
        localStorage.getItem("scoreup-anonymous-session"),
      ),
    ).toBe(anonymousSession);

    await hostContext.close();
    await guestContext.close();
  });

  test("a disconnected finalist times out safely and an unrelated context is rejected", async ({
    browser,
  }) => {
    const clients = await createStartedTwoClientMatch(browser, [
      "Timeout Host",
      "Timeout Guest",
    ]);
    const { host, guest, hostContext, guestContext, roomId } = clients;
    await enterPointDecisions(clients);
    const firstTurn = await activeTurn(clients);
    await firstTurn.active.getByRole("button", { name: "Lock In" }).click();
    await expect(host.locator(".game-round-label")).toContainText("2 / 6");

    provisionFinalTie(roomId);
    await expect(
      host.getByRole("heading", { name: "ONE LAST STOP." }),
    ).toBeVisible();
    await expect(guest.getByRole("button", { name: "STOP" })).toBeVisible();
    await host.getByRole("button", { name: "STOP" }).click();
    await expect(
      host.getByRole("heading", { name: "Your result is locked." }),
    ).toBeVisible();

    await guestContext.close();
    expireChampionship(roomId);
    await expect(host.getByText("OFFICIAL RESULT")).toBeVisible();
    await expect(host.getByText(/decided by timeout/i)).toBeVisible();

    const outsiderContext = await browser.newContext();
    const outsider = await outsiderContext.newPage();
    await outsider.goto(`/game?room=${roomId}`);
    await expect(
      outsider.getByRole("heading", { name: "MATCH UNAVAILABLE" }),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(host);
    await outsiderContext.close();
    await hostContext.close();
  });
});
