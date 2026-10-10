import { test, expect } from "@playwright/test";
test("landing navigation, honest setup state, mobile layout", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Your friends. Your music. Same frequency.",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Make a room" }).click();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
    await expect(
      page.getByRole("heading", { name: "Plug in your backstage." }),
    ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Find your people" }).click();
  await expect(page).toHaveURL(/dashboard/);
});
