import type { PlanQuantity } from "../domain/types";

export function formatMiles(value: number | null): string {
  if (value === null) return "Distance not prescribed";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} mi`;
}
export function formatPrescription(
  miles: number | null,
  quantity?: PlanQuantity,
): string {
  if (!quantity) return formatMiles(miles);
  const unit = quantity.unit;
  const number = (value: number) => Number(value.toFixed(2)).toString();
  return quantity.kind === "exact"
    ? `${number(quantity.value)} ${unit}`
    : `${number(quantity.min)}–${number(quantity.max)} ${unit}`;
}
export function formatPlannedMiles(
  value: number | null,
  range: { min: number; max: number } | null,
): string {
  if (!range) return "Distance not prescribed";
  if (value !== null) return formatMiles(value);
  return `${Number(range.min.toFixed(1))}–${Number(range.max.toFixed(1))} mi`;
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
