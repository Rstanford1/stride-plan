import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAppData } from "../data/app-context";
import { calculateWeeklyMetrics } from "../domain/metrics";
import { formatMiles } from "../utils/format";

export function TrendsScreen() {
  const { data } = useAppData();
  const maxWeek = Math.max(...data.sessions.map((session) => session.week));
  const chartData = useMemo(
    () =>
      Array.from({ length: maxWeek }, (_, index) => {
        const metrics = calculateWeeklyMetrics(
          index + 1,
          data.sessions,
          data.activities,
          data.journals,
        );
        return {
          week: `W${index + 1}`,
          planned: metrics.corePlannedMiles,
          actual: Number(metrics.actualMiles.toFixed(1)),
          completion:
            metrics.coreCompletionRate === null
              ? 0
              : Math.round(metrics.coreCompletionRate * 100),
        };
      }),
    [data, maxWeek],
  );
  const rpeData = data.journals
    .filter((entry) => entry.rpe)
    .map((entry) => ({
      date: entry.date.slice(5),
      rpe: entry.rpe,
      hr: entry.averageHr,
    }));
  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">Only useful signals</p>
          <h1>Trends</h1>
          <p>
            Weekly mileage and recorded effort, with matching tables for
            accessibility.
          </p>
        </div>
      </header>
      <div className="trend-grid">
        <section className="panel chart-panel">
          <h2>Planned and actual mileage</h2>
          <div className="chart" aria-hidden="true">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={chartData}
                margin={{ top: 15, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#dfe2dc"
                />
                <XAxis dataKey="week" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="planned"
                  name="Core planned"
                  fill="#c9cfca"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="actual"
                  name="Actual"
                  fill="#1f5a46"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="table-alternative">
            <summary>View as table</summary>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Core planned</th>
                  <th>Actual</th>
                  <th>Core completion</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((row) => (
                  <tr key={row.week}>
                    <td>{row.week}</td>
                    <td>{formatMiles(row.planned)}</td>
                    <td>{formatMiles(row.actual)}</td>
                    <td>{row.completion}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="panel chart-panel">
          <h2>Recorded RPE</h2>
          <div className="chart" aria-hidden="true">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={rpeData}
                margin={{ top: 15, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#dfe2dc"
                />
                <XAxis dataKey="date" />
                <YAxis domain={[1, 10]} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="rpe"
                  name="RPE"
                  stroke="#b75d35"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="table-alternative">
            <summary>View as table</summary>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>RPE</th>
                  <th>Average HR</th>
                </tr>
              </thead>
              <tbody>
                {rpeData.map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{row.rpe}/10</td>
                    <td>{row.hr ?? "Missing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      </div>
    </div>
  );
}
