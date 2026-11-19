export function classify({
  smoke = "",
  processes = "",
  startup = "",
  session = "",
}) {
  const observed =
    /stride-plan-qa-i13\.exe:\d+/.test(processes) ||
    startup.includes("process-started");
  const exited = processes.includes("qa-exit:");
  const samples = processes
    .split(/\r?\n/)
    .filter((line) => line && !line.includes("qa-exit:"));
  const running = /stride-plan-qa-i13\.exe:\d+/.test(samples.at(-1) || "");
  if (smoke && !smoke.startsWith("status: HTTP 200 ready=true"))
    return "Driver did not become ready; inspect driver-smoke.log.";
  if (smoke && processes && !observed)
    return "QA process was not observed; a short-lived process may have escaped sampling.";
  if (observed && !startup)
    return "QA process was observed but no verified startup marker was captured; inspect exit evidence.";
  if (startup.includes("process-started") && !startup.includes("setup-entered"))
    return "QA process started, but Tauri setup was not reached; inspect exit evidence.";
  if (startup.includes("isolation-rejected"))
    return "QA process rejected its resolved storage paths.";
  if (startup.includes("setup-entered") && !startup.includes("paths-verified"))
    return exited
      ? "QA exited before its isolation checks completed."
      : "QA setup entered but isolation checks did not complete; exit status is not established.";
  if (startup.includes("window-create-failed"))
    return "QA isolation passed but window creation failed.";
  if (startup.includes("paths-verified") && !startup.includes("window-created"))
    return running
      ? "QA isolation passed; the process was observed running but window creation did not complete."
      : "QA isolation passed; window creation did not complete. Inspect process exit evidence.";
  if (startup.includes("window-created") && !session)
    return exited
      ? "QA window was created, but the process exited before a WebDriver session was established."
      : running
        ? "QA window was created and the process was observed running, but no WebDriver session was established."
        : "QA window creation completed, but no WebDriver session was established; process state is unavailable.";
  if (session)
    return "WebDriver session was established; inspect the launch test and subsequent steps for their results.";
  return "Native launch not reached; inspect the first failed workflow step.";
}
