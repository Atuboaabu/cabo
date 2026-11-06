import { test, expect } from "@playwright/test";
test("Lobby → initial reveal → personal End → first table", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(
    page.getByRole("heading", { name: "记住两张，轻装上场。" }),
  ).toBeVisible();
  for (const position of [1, 3]) {
    await page.getByRole("button", { name: `选择第 ${position} 张牌` }).click();
    await page
      .getByRole("button", { name: `确认查看第 ${position} 张` })
      .click();
    await expect(page.getByLabel(`第 ${position} 张临时牌值`)).toHaveCount(1);
  }
  await expect(
    page.getByRole("button", { name: "选择第 2 张牌" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "结束查看" }).click();
  await expect(page.getByText("已结束查看，等待其他玩家。")).toBeVisible();
  await expect(page.getByLabel(/临时牌值/)).toHaveCount(0);
  await page.getByText("演示场景与连接测试", { exact: true }).click();
  await page.getByRole("button", { name: "模拟其他玩家结束查看" }).click();
  await expect(page.getByRole("heading", { name: "林间的回合" })).toBeVisible();
  expect(errors).toEqual([]);
});
test("early End modal cancels and does not pause the clock", async ({
  page,
}) => {
  await page.goto("/?scene=initial");
  await page.getByRole("button", { name: "结束查看" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("放弃剩余 2 次");
  await page.getByRole("button", { name: "继续查看" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "选择第 1 张牌" }),
  ).toBeEnabled();
});
test("takeover and unknown request outcome recover safely", async ({
  page,
}) => {
  await page.goto("/?scene=initial");
  await page.getByText("演示场景与连接测试", { exact: true }).click();
  await page.getByRole("button", { name: "下次响应丢失" }).click();
  await page.getByRole("button", { name: "选择第 1 张牌" }).click();
  await page.getByRole("button", { name: "确认查看第 1 张" }).click();
  await expect(page.getByRole("alert")).toContainText("结果尚不确定");
  await page.getByRole("button", { name: "核对请求结果" }).click();
  await expect(page.getByLabel("第 1 张临时牌值")).toHaveCount(1);
  await page.getByRole("button", { name: "模拟连接接管" }).click();
  await expect(page.getByRole("status")).toContainText("已被另一端接管");
  await expect(page.getByLabel(/临时牌值/)).toHaveCount(0);
  await page.getByRole("button", { name: "重新连接" }).click();
  await expect(page.getByLabel("第 1 张临时牌值")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "选择第 1 张牌" }),
  ).toBeDisabled();
});
test("table shows public cards and fits viewport; mock source is not served", async ({
  page,
  request,
}) => {
  await page.goto("/?scene=table");
  await expect(page.getByLabel("第 1 张公开牌 3")).toBeVisible();
  await expect(page.getByText("34 张 · 抽牌堆")).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const source = await request.get("/mock/service.ts");
  expect(source.status()).toBe(403);
  await page.screenshot({
    path: `test-results/table-${test.info().project.name}.png`,
    fullPage: true,
  });
});
