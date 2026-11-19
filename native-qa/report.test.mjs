import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./report-classify.mjs";

const ready = "status: HTTP 200 ready=true";
const running = "stamp stride-plan-qa-i13.exe:42:parent=1";
test("distinguishes driver, process, isolation, window and session boundaries", () => {
  assert.match(
    classify({ smoke: "status: unavailable" }),
    /Driver did not become ready/,
  );
  assert.match(
    classify({ smoke: "status: HTTP 200 ready=false" }),
    /Driver did not become ready/,
  );
  assert.match(
    classify({ smoke: ready, processes: "stamp" }),
    /process was not observed/,
  );
  assert.match(
    classify({
      smoke: ready,
      processes: "stamp qa-exit:42 code=1",
      startup: "process-started\nsetup-entered",
    }),
    /exited before its isolation checks/,
  );
  assert.match(
    classify({
      smoke: ready,
      processes: running,
      startup: "process-started\nsetup-entered\npaths-verified",
    }),
    /running but window creation did not complete/,
  );
  assert.match(
    classify({
      smoke: ready,
      processes: running,
      startup: "process-started\nsetup-entered\npaths-verified\nwindow-created",
    }),
    /window was created.*no WebDriver session/,
  );
  assert.match(
    classify({
      smoke: ready,
      processes: running,
      startup: "process-started\nsetup-entered\npaths-verified\nwindow-created",
      session: "established",
    }),
    /session was established/,
  );
});
