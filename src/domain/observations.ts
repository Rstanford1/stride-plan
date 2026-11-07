import { calculateWeeklyMetrics } from "./metrics";
import type {
  Activity,
  JournalEntry,
  Observation,
  PlannedSession,
} from "./types";

export function buildObservations(
  week: number,
  sessions: PlannedSession[],
  activities: Activity[],
  journals: JournalEntry[],
): Observation[] {
  const observations: Observation[] = [];
  const weeklySessions = sessions.filter((session) => session.week === week);
  const ids = new Set(weeklySessions.map((session) => session.id));
  const weeklyJournals = journals.filter(
    (entry) => entry.sessionId && ids.has(entry.sessionId),
  );
  const metrics = calculateWeeklyMetrics(week, sessions, activities, journals);
  const weeklyActivities = activities.filter(
    (activity) =>
      activity.plannedSessionId && ids.has(activity.plannedSessionId),
  );

  if (metrics.coreTotal > 0 && metrics.coreCompleted === metrics.coreTotal) {
    observations.push({
      id: `completed-core-${week}`,
      title: "Core week completed",
      summary: "Every core session is recorded as completed.",
      evidence: [
        {
          label: "Core sessions",
          recordIds: weeklySessions
            .filter((s) => !s.flexible && s.kind !== "rest")
            .map((s) => s.id),
          detail: `${metrics.coreCompleted} of ${metrics.coreTotal} completed`,
        },
      ],
      missingData: [],
    });
  }

  const soreness = weeklyJournals.filter(
    (entry) => entry.soreness && entry.soreness !== "none",
  );
  if (soreness.length >= 2) {
    observations.push({
      id: `recurring-soreness-${week}`,
      title: "Recurring soreness to review",
      summary:
        "Soreness was recorded on two or more journal entries. This is a review prompt, not a diagnosis.",
      evidence: [
        {
          label: "Journal entries",
          recordIds: soreness.map((entry) => entry.id),
          detail: soreness
            .map(
              (entry) =>
                `${entry.date}: ${entry.soreness}${entry.sorenessLocation ? ` (${entry.sorenessLocation})` : ""}`,
            )
            .join("; "),
        },
      ],
      missingData: weeklyJournals.some((entry) => !entry.sorenessLocation)
        ? ["Location is missing for at least one entry."]
        : [],
    });
  }

  const highEasyRpe = weeklyJournals.filter((entry) => {
    const target = weeklySessions.find(
      (session) => session.id === entry.sessionId,
    );
    return (
      target &&
      ["easy", "recovery"].includes(target.kind) &&
      (entry.rpe ?? 0) >= 7
    );
  });
  if (highEasyRpe.length) {
    observations.push({
      id: `high-easy-rpe-${week}`,
      title: "High effort on an easy run",
      summary: "An easy or recovery session was rated 7/10 or higher.",
      evidence: [
        {
          label: "Journal entries",
          recordIds: highEasyRpe.map((entry) => entry.id),
          detail: highEasyRpe
            .map((entry) => `${entry.date}: RPE ${entry.rpe}/10`)
            .join("; "),
        },
      ],
      missingData: [],
    });
  }

  const diverged = weeklySessions.filter((session) =>
    ["modified", "skipped"].includes(session.status),
  );
  if (diverged.length >= 2) {
    observations.push({
      id: `plan-divergence-${week}`,
      title: "Plan divergence",
      summary: "Two or more core decisions differed from the current plan.",
      evidence: [
        {
          label: "Sessions",
          recordIds: diverged.map((session) => session.id),
          detail: diverged
            .map((session) => `${session.scheduledDate}: ${session.status}`)
            .join("; "),
        },
      ],
      missingData: diverged
        .filter((session) => !session.outcomeNote)
        .map((session) => `Outcome note missing for ${session.scheduledDate}.`),
    });
  }

  const workLapActivities = weeklyActivities.filter(
    (activity) =>
      activity.laps.filter((lap) => lap.role === "work").length >= 3,
  );
  for (const activity of workLapActivities) {
    const laps = activity.laps.filter(
      (lap) => lap.role === "work" && lap.distanceMiles > 0,
    );
    const paces = laps.map((lap) => lap.durationSeconds / lap.distanceMiles);
    const average = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
    const spread = Math.max(...paces) - Math.min(...paces);
    if (spread / average <= 0.05) {
      observations.push({
        id: `consistent-work-laps-${activity.id}`,
        title: "Consistent work laps",
        summary: "Recorded work-lap pace stayed within a 5% range.",
        evidence: [
          {
            label: "Work laps",
            recordIds: laps.map((lap) => lap.id),
            detail: `${laps.length} work laps in ${activity.fileName}; pace spread ${Math.round((spread / average) * 100)}%`,
          },
        ],
        missingData: laps.some((lap) => lap.averageHr === undefined)
          ? ["Heart rate is missing for at least one work lap."]
          : [],
      });
    }
    const slowing = paces
      .slice(1)
      .every((pace, index) => pace >= paces[index] * 1.02);
    if (slowing) {
      observations.push({
        id: `deteriorating-work-laps-${activity.id}`,
        title: "Work laps slowed across the session",
        summary:
          "Each recorded work lap was at least 2% slower than the previous one.",
        evidence: [
          {
            label: "Work laps",
            recordIds: laps.map((lap) => lap.id),
            detail: paces
              .map(
                (pace, index) =>
                  `Lap ${index + 1}: ${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, "0")}/mi`,
              )
              .join("; "),
          },
        ],
        missingData: [],
      });
    }
  }

  const strainEntries = weeklyJournals.filter(
    (entry) =>
      (entry.rpe ?? 0) >= 7 ||
      entry.sleep === "a-little" ||
      entry.sleep === "barely" ||
      entry.soreness === "moderate" ||
      entry.soreness === "severe",
  );
  if (strainEntries.length >= 3) {
    observations.push({
      id: `subjective-strain-${week}`,
      title: "Accumulated subjective strain",
      summary:
        "Three or more entries recorded high effort, limited sleep, or moderate/severe soreness.",
      evidence: [
        {
          label: "Journal entries",
          recordIds: strainEntries.map((entry) => entry.id),
          detail: strainEntries
            .map(
              (entry) =>
                `${entry.date}: RPE ${entry.rpe ?? "missing"}, sleep ${entry.sleep ?? "missing"}, soreness ${entry.soreness ?? "missing"}`,
            )
            .join("; "),
        },
      ],
      missingData: weeklyJournals
        .filter(
          (entry) =>
            entry.rpe === undefined ||
            entry.sleep === undefined ||
            entry.soreness === undefined,
        )
        .map(
          (entry) => `Some subjective fields are missing for ${entry.date}.`,
        ),
    });
  }

  const comparable = activities
    .filter(
      (activity) =>
        activity.durationSeconds &&
        activity.averageHr &&
        activity.plannedSessionId,
    )
    .map((activity) => ({
      activity,
      session: sessions.find(
        (session) => session.id === activity.plannedSessionId,
      ),
      pace: activity.durationSeconds! / activity.distanceMiles,
    }))
    .filter((item) => item.session?.kind === "easy")
    .sort((a, b) => a.activity.occurredAt.localeCompare(b.activity.occurredAt));
  if (comparable.length >= 3) {
    const latest = comparable.at(-1)!;
    const baseline = comparable.slice(-3, -1);
    const baselinePace =
      baseline.reduce((sum, item) => sum + item.pace, 0) / baseline.length;
    const baselineHr =
      baseline.reduce((sum, item) => sum + (item.activity.averageHr ?? 0), 0) /
      baseline.length;
    if (
      latest.pace >= baselinePace * 1.05 &&
      (latest.activity.averageHr ?? 0) >= baselineHr + 5
    ) {
      observations.push({
        id: `hr-pace-mismatch-${latest.activity.id}`,
        title: "Comparable-run HR/pace mismatch",
        summary:
          "The latest comparable easy run was at least 5% slower with heart rate at least 5 bpm higher.",
        evidence: [
          {
            label: "Activities",
            recordIds: [...baseline, latest].map((item) => item.activity.id),
            detail: `Latest ${Math.round(latest.pace)} sec/mi at ${latest.activity.averageHr} bpm; prior average ${Math.round(baselinePace)} sec/mi at ${Math.round(baselineHr)} bpm.`,
          },
        ],
        missingData: [],
      });
    }
  }

  return observations;
}
