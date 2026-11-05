import type { SessionController } from "../data/session";
export function ConnectionBanner({ client }: { client: SessionController }) {
  const s = client.state;
  const messages = {
    "demo-ended":
      "演示快照已到边界。此里程碑未模拟普通 Turn 超时，请重新载入演示场景。",
    connected: "",
    syncing: "正在同步当前视图…",
    disconnected: "连接已断开。倒计时继续，私人牌值已清除。",
    "taken-over": "此连接已被另一端接管。已受理的操作不会撤销。",
    incompatible: "当前必需语义版本不兼容，已停止相关操作。请更新客户端。",
  };
  const rejected = s.result?.status === "Rejected";
  return (
    <>
      {s.connection !== "connected" && (
        <div className="notice" role="status">
          <span>{messages[s.connection]}</span>
          {["disconnected", "taken-over"].includes(s.connection) && (
            <button
              className="secondary"
              disabled={s.busy}
              onClick={() => void client.reconnect()}
            >
              重新连接
            </button>
          )}
        </div>
      )}
      {(s.error || s.pending || rejected) && (
        <div className="notice warning" role="alert">
          <div>
            {s.error ||
              (rejected
                ? s.result?.reason === "StaleDecision"
                  ? "选择已过期，已重新同步。请按当前视图重新选择。"
                  : "请求未被接受；请检查当前可用操作。"
                : "正在等待原请求的确定结果…")}
            {s.result?.status === "NotYetDetermined" && (
              <p>尚未确定不等于拒绝；不能换请求身份重做。</p>
            )}
            {s.result?.status === "OutsideScope" && (
              <p>
                原结果已不可查询；不代表原操作未发生。请同步当前状态，不要盲目重做。
              </p>
            )}
          </div>
          {s.pending && (
            <div className="tool-buttons">
              <button
                className="secondary"
                disabled={s.busy || s.connection !== "connected"}
                onClick={() => void client.resolve()}
              >
                核对请求结果
              </button>
              {s.result?.status === "OutsideScope" ? (
                <button
                  disabled={s.busy || s.connection !== "connected"}
                  onClick={() => void client.leaveOldRequest()}
                >
                  同步并继续新决策
                </button>
              ) : (
                <button
                  disabled={s.busy || s.connection !== "connected"}
                  onClick={() => void client.retry()}
                >
                  按原请求重试
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
