export function Countdown({
  deadline,
  now,
  label,
}: {
  deadline: number;
  now: number;
  label: string;
}) {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <div className={`countdown ${seconds <= 10 ? "urgent" : ""}`}>
      <span>{label}</span>
      <strong role="timer" aria-label={label}>
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:
        {String(seconds % 60).padStart(2, "0")}
      </strong>
      <small>
        {seconds === 0
          ? "等待服务器同步"
          : `截止 ${new Date(deadline).toLocaleTimeString("zh-CN", { hour12: false })}`}
      </small>
    </div>
  );
}
