export function formatMiles(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} mi`;
}

export function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...options,
  }).format(new Date(`${date}T12:00:00`));
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function paceFrom(
  distanceMiles: number,
  durationSeconds?: number,
): string {
  if (!durationSeconds || distanceMiles <= 0) return "—";
  const seconds = Math.round(durationSeconds / distanceMiles);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/mi`;
}
