import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect } from "vitest";
import { App } from "../src/App";
import { SessionController } from "../src/data/session";
import { DemoService } from "../mock/service";
function mount(scenario = "initial") {
  let time = 1000;
  const service = new DemoService(() => time);
  const id = service.open(scenario);
  const client = new SessionController(
    {
      read: async () => service.read(id),
      command: async (r) => service.command(id, r),
      lookup: async (r) => service.lookup(id, r),
      reconnect: async () => {
        service.reconnect(id);
      },
    },
    () => time,
  );
  render(<App client={client} />);
  return {
    client,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
it("non-host can ready and unready, has no host Start", async () => {
  mount("member");
  fireEvent.click(await screen.findByRole("button", { name: "准备好了" }));
  expect(await screen.findByRole("button", { name: "取消准备" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "开始游戏" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消准备" }));
  expect(await screen.findByRole("button", { name: "准备好了" })).toBeEnabled();
});
it("host Start opens four cards without revealing them", async () => {
  mount("host");
  fireEvent.click(await screen.findByRole("button", { name: "开始游戏" }));
  expect(
    await screen.findByRole("heading", { name: "记住两张，轻装上场。" }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole("button", { name: /选择第 \d 张牌/ }),
  ).toHaveLength(4);
  expect(screen.queryByLabelText(/临时牌值/)).not.toBeInTheDocument();
});
it("early End requires confirmation; cancel preserves the opportunity", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "结束查看" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("放弃剩余 2 次");
  fireEvent.click(screen.getByRole("button", { name: "继续查看" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "结束查看" }));
  fireEvent.click(screen.getByRole("button", { name: "确认结束" }));
  expect(
    await screen.findByText("已结束查看，等待其他玩家。"),
  ).toBeInTheDocument();
});
it("two confirmed cards remain visible until End, cannot select third", async () => {
  mount();
  for (const position of [1, 2]) {
    fireEvent.click(
      await screen.findByRole("button", { name: `选择第 ${position} 张牌` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `确认查看第 ${position} 张` }),
    );
    await screen.findByLabelText(`第 ${position} 张临时牌值`);
  }
  expect(screen.getByRole("button", { name: "选择第 3 张牌" })).toBeDisabled();
  expect(screen.getAllByLabelText(/临时牌值/)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "结束查看" }));
  await waitFor(() =>
    expect(screen.queryByLabelText(/临时牌值/)).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("expiry closes an open early-End confirmation and cannot revive the old decision", async () => {
  const { client, advance } = mount();
  fireEvent.click(await screen.findByRole("button", { name: "结束查看" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  const { act } = await import("@testing-library/react");
  act(() => {
    advance(45000);
    client.tick();
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "结束查看" })).toBeDisabled();
});
