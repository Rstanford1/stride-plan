import { useEffect, useRef, useState } from "react";
import {
  garmin,
  garminError,
  type GarminActivity,
  type GarminStatus,
} from "../data/garmin";

export function GarminIntegration() {
  const available = garmin.available();
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [loading, setLoading] = useState(available);
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activities, setActivities] = useState<GarminActivity[] | null>(null);
  const [selected, setSelected] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const working = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (available) {
      void garmin
        .status()
        .then((value) => {
          if (mounted.current) setStatus(value);
        })
        .catch((reason: unknown) => {
          if (mounted.current) setError(garminError(reason));
        })
        .finally(() => {
          if (mounted.current) setLoading(false);
        });
    }
    return () => {
      mounted.current = false;
      if (working.current) void garmin.cancel().catch(() => {});
    };
  }, [available]);

  async function run(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (reason) {
      if (mounted.current) {
        setError(garminError(reason));
        if (
          typeof reason === "object" &&
          reason !== null &&
          "code" in reason &&
          reason.code === "authentication"
        ) {
          setStatus(
            (current) => current && { ...current, verifiedThisSession: false },
          );
        }
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function connect() {
    const submitted = key;
    // Clear DOM and React state before starting IPC, including rejection paths.
    if (input.current) input.current.value = "";
    setKey("");
    setVisible(false);
    void run(async () => {
      const next = await garmin.connect(submitted);
      if (!mounted.current) return;
      setStatus(next);
      setActivities(null);
      setSelected("");
      setMessage(
        "Connection verified. The key is saved in Windows Credential Manager.",
      );
    });
  }
  return (
    <section
      className="panel preferences garmin-integration"
      aria-labelledby="garmin-heading"
      aria-busy={busy || loading}
    >
      <p className="eyebrow">Integrations</p>
      <h2 id="garmin-heading">Garmin Connect</h2>
      <p>
        Connect your own Garmin Personal API key to verify access and retrieve
        one original recording at a time.
      </p>
      <p>
        Your credential stays in Windows Credential Manager on this device. Rust
        sends it only to Garmin over HTTPS. Keys and tokens are excluded from
        app backups.
      </p>
      {!available ? (
        <p>
          Available in the Windows desktop app. Browser development cannot store
          credentials or connect to Garmin.
        </p>
      ) : (
        <>
          {loading && <p role="status">Checking local credential status…</p>}
          {status && (
            <div>
              <p>
                <strong>
                  {status.credentialStored
                    ? "Connected · credential stored"
                    : "Disconnected"}
                </strong>
              </p>
              {status.credentialStored && (
                <>
                  <p>
                    Credential status:{" "}
                    {status.verifiedThisSession
                      ? "verified this session"
                      : "stored; verify to check access"}
                    .
                  </p>
                  <p>
                    Last successful connection verification:{" "}
                    {status.lastVerifiedAt
                      ? new Date(status.lastVerifiedAt * 1000).toLocaleString()
                      : "Not yet verified"}
                  </p>
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setStatus(
                            (current) =>
                              current && {
                                ...current,
                                verifiedThisSession: false,
                              },
                          );
                          setStatus(await garmin.verify());
                          setMessage("Connection verified.");
                        })
                      }
                    >
                      Verify connection
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Disconnect Garmin and delete the locally saved key? Preserved FIT files will be retained.",
                          )
                        )
                          void run(async () => {
                            setStatus(await garmin.disconnect());
                            setActivities(null);
                            setSelected("");
                            setKey("");
                            setVisible(false);
                            setMessage(
                              "Disconnected. The saved credential was deleted; original FIT files were retained.",
                            );
                          });
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              connect();
            }}
          >
            <label htmlFor="garmin-api-key">
              {status?.credentialStored
                ? "Replace Personal API key"
                : "Personal API key"}
            </label>
            <div className="garmin-key-row">
              <input
                ref={input}
                id="garmin-api-key"
                type={visible ? "text" : "password"}
                value={key}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={2048}
                disabled={busy || loading || !status}
                onChange={(event) => setKey(event.target.value)}
              />
              <button
                className="button secondary"
                type="button"
                disabled={busy || loading || !status}
                aria-pressed={visible}
                aria-controls="garmin-api-key"
                onClick={() => setVisible(!visible)}
              >
                {visible ? "Hide key" : "Show key"}
              </button>
            </div>
            <p>
              <a
                href="https://connect.garmin.com/app/settings/personalApiToken"
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void garmin
                    .openKeyPage()
                    .catch((reason: unknown) => setError(garminError(reason)));
                }}
              >
                Create a Garmin Personal API key (opens in browser)
              </a>
            </p>
            <button
              className="button primary"
              type="submit"
              disabled={busy || loading || !status || !key.trim()}
            >
              Connect and Verify
            </button>
          </form>
          {status?.credentialStored && (
            <div>
              <h3>Test activity retrieval</h3>
              <p>
                List up to five recent running activities, then preserve one
                original FIT. This does not create a workout, update totals, or
                change your plan or shoes.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setActivities(null);
                    setSelected("");
                    const rows = await garmin.list();
                    if (!mounted.current) return;
                    setActivities(rows);
                  })
                }
              >
                List recent activities
              </button>
              {activities?.length === 0 && (
                <p>No recent running activities were returned.</p>
              )}
              {!!activities?.length && (
                <>
                  <label htmlFor="garmin-activity">Activity to retrieve</label>
                  <select
                    id="garmin-activity"
                    value={selected}
                    disabled={busy}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    <option value="">Select one activity</option>
                    {activities.map((activity) => (
                      <option
                        key={activity.activityId}
                        value={activity.activityId}
                      >
                        {activity.date ?? "Date unavailable"} · Garmin{" "}
                        {activity.activityId}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button primary"
                    disabled={busy || !selected}
                    onClick={() =>
                      void run(async () => {
                        const result = await garmin.retrieve(selected);
                        if (mounted.current)
                          setMessage(
                            `Original FIT preserved and verified (${result.source.byteLength.toLocaleString()} bytes). Garmin activity ${result.activityId}. SHA-256: ${result.source.sourceHash}. Repeated retrieval reuses the same source. No workout was created.`,
                          );
                      })
                    }
                  >
                    Retrieve selected activity
                  </button>
                </>
              )}
            </div>
          )}
          {busy && (
            <div className="button-row">
              <p role="status">Working with Garmin…</p>
              <button
                className="button secondary"
                onClick={() =>
                  void garmin
                    .cancel()
                    .catch(() =>
                      setError(
                        "Cancellation could not be requested. The operation has a time limit.",
                      ),
                    )
                }
              >
                Cancel operation
              </button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          {message && (
            <p role="status" className="garmin-result">
              {message}
            </p>
          )}
          {!loading && !status && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => setStatus(await garmin.status()))
              }
            >
              Retry local status
            </button>
          )}
        </>
      )}
    </section>
  );
}
