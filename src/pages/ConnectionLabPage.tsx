import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Badge, type Tone } from "../components/ui/Badge.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Card } from "../components/ui/Card.tsx";
import { MetricTile } from "../components/ui/MetricTile.tsx";
import { PageHeader } from "../components/ui/PageHeader.tsx";
import { cn } from "../lib/cn.ts";
import { formatTimestamp } from "../lib/format.ts";
import {
  live,
  liveTranscript,
  useLiveSnapshot,
  type LiveSnapshot,
} from "../features/realtime/liveSession.ts";
import {
  SLOW_DELAYS,
  SLOW_SPEEDS,
  type NetworkCondition,
} from "../features/realtime/networkSimulator.ts";

const REPLAY_LIMIT_DEMO = 200;
const RECENT_MS = 8_000;

const secs = (ms: number) =>
  ms < 100
    ? "under 0.1 s"
    : ms < 10_000
      ? `${(ms / 1000).toFixed(1)} s`
      : `${Math.round(ms / 1000)} s`;

const CONDITIONS: {
  value: NetworkCondition;
  label: string;
  description: string;
}[] = [
  {
    value: "normal",
    label: "Normal connection",
    description: "Messages arrive as soon as they are received.",
  },
  {
    value: "slow",
    label: "Slow connection",
    description: "Each message is held back and data trickles in slowly.",
  },
  {
    value: "unstable",
    label: "Unstable connection",
    description:
      "Delivery pauses now and then, and the connection sometimes drops for a few seconds.",
  },
  {
    value: "lost",
    label: "Connection lost",
    description: "The connection is cut until you restore it.",
  },
];

const CONDITION_LABEL: Record<NetworkCondition, string> = {
  normal: "Normal",
  slow: "Slow (simulated)",
  unstable: "Unstable (simulated)",
  lost: "Lost (simulated)",
};

/** One plain-language sentence for what the user is experiencing right now. */
function overall(s: LiveSnapshot): {
  tone: Tone;
  title: string;
  detail: string;
} {
  const condition = s.network?.condition ?? "normal";
  const recent =
    s.recovery?.done && Date.now() - s.recovery.at < RECENT_MS
      ? s.recovery
      : null;
  switch (s.state) {
    case "disconnected":
      return {
        tone: "neutral",
        title: "The Live Feed is off.",
        detail:
          "Start the sample hearing below, or use Start Listening on the Courtroom page.",
      };
    case "connecting":
      return {
        tone: "info",
        title: "Connecting…",
        detail: "Opening the Live Feed connection.",
      };
    case "reconnecting":
      return {
        tone: "danger",
        title: "Connection interrupted. We are trying to reconnect.",
        detail:
          condition === "lost"
            ? "Updates already on screen are kept. Restore the connection and missed updates will be fetched."
            : `Updates already on screen are kept.${s.nextRetryInMs !== null ? ` Next try in ${secs(s.nextRetryInMs)}.` : ""}`,
      };
    case "syncing":
      return {
        tone: "info",
        title: "Connection restored. Catching up on missed updates…",
        detail:
          "Updates sent while you were disconnected are arriving in their original order.",
      };
    case "connected":
      if (recent && recent.unrecoverable > 0)
        return {
          tone: "warning",
          title: "Some updates could not be recovered.",
          detail: `${recent.unrecoverable.toLocaleString()} updates were too old for the server to send again.`,
        };
      if (recent)
        return {
          tone: "success",
          title: "Connection restored. Resuming the Live Feed.",
          detail: "All missed updates were recovered.",
        };
      if (condition === "unstable")
        return {
          tone: "warning",
          title: "Your connection is unstable.",
          detail:
            "Updates may pause and then arrive together, and the connection may drop briefly.",
        };
      if (condition === "slow" || (s.recentDelayMs ?? 0) > 1_000)
        return {
          tone: "warning",
          title:
            "Your internet is slow. New updates may take longer to appear.",
          detail: "Nothing is lost — updates arrive in order, just later.",
        };
      return {
        tone: "success",
        title: "Your connection is working normally.",
        detail: "New updates appear as soon as they arrive.",
      };
  }
}

function feedHealth(s: LiveSnapshot): {
  label: string;
  tone: "good" | "warning" | "danger" | "default";
} {
  if (s.state === "disconnected") return { label: "Off", tone: "default" };
  if (s.state === "connecting" || s.state === "reconnecting")
    return { label: "Disconnected", tone: "danger" };
  if (
    s.state === "syncing" ||
    s.network?.stalled ||
    (s.recentDelayMs ?? 0) > 1_000 ||
    s.waiting > 5
  )
    return { label: "Delayed", tone: "warning" };
  return { label: "Normal", tone: "good" };
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-800",
  info: "border-accent-200 bg-accent-50 text-slate-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
};

/** The last few lines of the live transcript; replays after a reconnect are marked "Recovered". */
function LatestUpdates() {
  useSyncExternalStore(liveTranscript.subscribe, liveTranscript.getVersion);
  const size = liveTranscript.size;
  const rows = [];
  for (let i = Math.max(0, size - 8); i < size; i++) {
    const seg = liveTranscript.at(i);
    if (seg) rows.push(seg);
  }
  if (rows.length === 0)
    return (
      <p className="py-6 text-center text-sm text-slate-500">No updates yet.</p>
    );
  return (
    <ol
      className="flex flex-col divide-y divide-slate-100"
      aria-label="Latest updates"
      aria-live="off"
    >
      {rows.map((seg) => (
        <li key={seg.id} className="flex gap-3 py-2 text-sm">
          <span className="tabular w-16 shrink-0 font-mono text-xs text-slate-500">
            {formatTimestamp(seg.startTime)}
          </span>
          <div className="min-w-0 flex-1">
            <span className="mr-2 font-semibold text-slate-800">
              {seg.speakerName}
            </span>
            <span
              className={
                seg.isPartial ? "text-slate-500 italic" : "text-slate-800"
              }
            >
              {seg.text}
            </span>
          </div>
          {live.recoveredSegments.has(seg.id) && (
            <Badge
              tone="info"
              title="Sent again by the server after the connection came back"
            >
              Recovered
            </Badge>
          )}
        </li>
      ))}
    </ol>
  );
}

function NetworkControls({ s }: { s: LiveSnapshot }) {
  const net = s.network!;
  const offline = s.state === "disconnected";
  const replayLimited = s.replayLimit > 0;
  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Network condition"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"
      >
        {CONDITIONS.map((c) => {
          const active = net.condition === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={offline}
              onClick={() => live.setNetworkCondition(c.value)}
              className={cn(
                "flex flex-col gap-1 rounded-lg border-2 px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? c.value === "normal"
                    ? "border-emerald-600 bg-emerald-50"
                    : c.value === "lost"
                      ? "border-red-600 bg-red-50"
                      : "border-amber-500 bg-amber-50"
                  : "border-slate-200 bg-white enabled:hover:border-slate-400",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span
                  className={cn(
                    "size-2.5 rounded-full border",
                    active
                      ? "border-transparent bg-current"
                      : "border-slate-400",
                  )}
                  aria-hidden="true"
                />
                {c.label}
              </span>
              <span className="text-xs text-slate-600">{c.description}</span>
            </button>
          );
        })}
      </div>

      {net.condition === "slow" && (
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-slate-600 uppercase">
            Extra delay
            <select
              value={net.slow.delayMs}
              onChange={(e) =>
                live.setSlowNetwork({ delayMs: Number(e.target.value) })
              }
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal tracking-normal text-slate-800 normal-case"
            >
              {SLOW_DELAYS.map((d) => (
                <option key={d} value={d}>
                  {secs(d)} per message
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-slate-600 uppercase">
            Speed
            <select
              value={net.slow.bytesPerSecond}
              onChange={(e) =>
                live.setSlowNetwork({ bytesPerSecond: Number(e.target.value) })
              }
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal tracking-normal text-slate-800 normal-case"
            >
              {SLOW_SPEEDS.map((b) => (
                <option key={b} value={b}>
                  {b / 1024} KB per second
                  {b === SLOW_SPEEDS[0]
                    ? " (very slow — a backlog builds up)"
                    : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {net.condition !== "normal" && (
        <div>
          <Button
            variant="primary"
            onClick={() => live.setNetworkCondition("normal")}
          >
            Restore normal connection
          </Button>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-navy-900"
          checked={replayLimited}
          disabled={offline}
          onChange={(e) =>
            live.setReplayLimit(e.target.checked ? REPLAY_LIMIT_DEMO : 0)
          }
        />
        <span>
          Server remembers only the last {REPLAY_LIMIT_DEMO} updates
          <span className="block text-xs text-slate-500">
            Normally it keeps 50,000. Turn this on and stay disconnected for a
            while to see what happens when some updates are too old to send
            again.
          </span>
        </span>
      </label>

      <p className="text-xs text-slate-500">
        This simulation holds back messages inside CourtScribe after they arrive
        — it does not slow down your computer’s internet. For real bandwidth
        throttling, use your browser’s developer tools (Chrome: DevTools →
        Network → Throttling). Microphone recording is not affected. Leaving
        this page restores a normal connection.
      </p>
    </div>
  );
}

function RecoveryCard({ s }: { s: LiveSnapshot }) {
  const r = s.recovery;
  if (!r)
    return (
      <p className="text-sm text-slate-600">
        No interruptions yet. Choose <b>Connection lost</b>, wait a few seconds
        while the hearing continues, then <b>Restore normal connection</b>.
      </p>
    );
  const recovered = Math.max(0, r.missed - r.unrecoverable);
  return (
    <div className="flex flex-col gap-3">
      <p
        className={cn(
          "text-sm font-medium",
          !r.done
            ? "text-slate-700"
            : r.unrecoverable > 0
              ? "text-amber-800"
              : "text-emerald-800",
        )}
        role="status"
      >
        {!r.done
          ? "Catching up…"
          : r.unrecoverable > 0
            ? "Some updates could not be recovered."
            : "All missed updates were recovered."}
        <span className="ml-2 text-xs font-normal text-slate-500">
          Last interruption ended {new Date(r.at).toLocaleTimeString()}
        </span>
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Missed while away"
          value={r.missed.toLocaleString()}
          info="Updates the server sent after the last one this browser had confirmed receiving."
        />
        <MetricTile
          label="Recovered"
          value={recovered.toLocaleString()}
          tone={recovered > 0 ? "good" : "default"}
          info="Sent again by the server when the connection came back, and added in their original order. They are marked “Recovered” in the list."
        />
        <MetricTile
          label="Could not be recovered"
          value={r.unrecoverable.toLocaleString()}
          tone={r.unrecoverable > 0 ? "danger" : "default"}
          info="Updates older than the server keeps. They are reported here rather than silently skipped."
        />
        <MetricTile
          label="Repeats ignored"
          value={r.duplicatesIgnored.toLocaleString()}
          info="Updates that arrived twice during recovery. They were recognised and not shown a second time."
        />
      </div>
    </div>
  );
}

export function ConnectionLabPage() {
  const s = useLiveSnapshot();
  const [, setTick] = useState(0);
  // "Last update n s ago" keeps counting even when nothing arrives.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);
  // The simulation is a demonstration: never leave the rest of the app on a degraded connection.
  // Leaving the page also stops the sample hearing it started.
  useEffect(
    () => () => {
      live.setNetworkCondition("normal");
      if (live.sampleRequested) live.setSampleHearing(false);
    },
    [],
  );

  const header = (
    <PageHeader
      eyebrow="Live Feed"
      title="Connection & Reliability"
      description="See whether CourtScribe is connected, how quickly updates arrive, and what happens when the internet is slow or drops."
    />
  );

  if (s.localMode || s.configError || !s.network) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card title="Not available here">
          <p className="text-sm text-slate-700">
            {s.localMode
              ? "This version of CourtScribe has no Live Feed server: speech is turned into text inside this browser, so there is no connection to slow down or interrupt."
              : s.configError
                ? s.configError
                : "The connection simulation is switched off in this build."}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            The demonstration runs when CourtScribe is started with its Live
            Feed server (
            <code className="rounded bg-slate-100 px-1">npm run dev</code>)
            {s.localMode || s.configError
              ? ""
              : ", or in a build made with VITE_NETWORK_SIMULATION=true"}
            .
          </p>
        </Card>
      </div>
    );
  }

  const status = overall(s);
  const health = feedHealth(s);
  const active = s.state !== "disconnected";
  const sampleRunning = Boolean(s.server?.config.running);

  return (
    <div className="flex flex-col gap-6">
      {header}

      <div
        className={cn("rounded-lg border px-4 py-3", TONE_CLASS[status.tone])}
        role="status"
        aria-live="polite"
      >
        <p className="text-base font-semibold">{status.title}</p>
        <p className="text-sm opacity-90">{status.detail}</p>
      </div>

      <Card
        title="Connection"
        info="Measured live in this browser from the real Live Feed connection. “Waiting to appear” counts updates that have reached this computer but are not on screen yet — held back by the simulated network or still being processed."
        actions={
          active ? (
            <Button
              size="sm"
              variant={sampleRunning ? "secondary" : "primary"}
              onClick={() => live.setSampleHearing(!sampleRunning)}
            >
              {sampleRunning ? "Stop sample hearing" : "Start sample hearing"}
            </Button>
          ) : undefined
        }
      >
        {!active ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="max-w-xl text-sm text-slate-700">
              Start the Live Feed to try this. The <b>sample hearing</b> plays
              made-up courtroom dialogue through the real Live Feed connection,
              at about five updates a second. You can also speak using{" "}
              <b>Start Listening</b> on the{" "}
              <Link
                to="/workspace"
                className="font-medium text-navy-900 underline underline-offset-2"
              >
                Courtroom
              </Link>{" "}
              page.
            </p>
            <Button
              variant="primary"
              onClick={() => live.setSampleHearing(true)}
            >
              Start sample hearing
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <MetricTile
              label="Live Feed"
              value={health.label}
              tone={health.tone}
              info="Normal: updates appear straight away. Delayed: they are arriving late or catching up. Disconnected: no connection right now."
            />
            <MetricTile
              label="Network"
              value={CONDITION_LABEL[s.network.condition]}
              tone={
                s.network.condition === "normal"
                  ? "default"
                  : s.network.condition === "lost"
                    ? "danger"
                    : "warning"
              }
              info="The network condition you chose below. Simulated conditions affect only the Live Feed in this browser tab."
            />
            <MetricTile
              label="Updates received"
              value={s.processed.toLocaleString()}
              info="Transcript updates that have arrived and been shown, counting each one once."
            />
            <MetricTile
              label="Waiting to appear"
              value={s.waiting.toLocaleString()}
              tone={s.waiting > 20 ? "warning" : "default"}
              info="Updates that reached this computer but are not on screen yet. They are shown in order as soon as they are released."
            />
            <MetricTile
              label="Last update"
              value={
                s.lastShownAgoMs === null
                  ? "—"
                  : `${secs(s.lastShownAgoMs)} ago`
              }
              hint={!sampleRunning ? "Sample hearing is stopped" : undefined}
              info="How long since a new line or word last appeared."
            />
            <MetricTile
              label="Time for updates to appear"
              value={s.recentDelayMs === null ? "—" : secs(s.recentDelayMs)}
              tone={(s.recentDelayMs ?? 0) > 1_000 ? "warning" : "default"}
              info="Typical time between an update reaching this computer and it appearing on screen, over the last few seconds. Includes any simulated delay; shows — when nothing has appeared recently."
            />
          </div>
        )}
      </Card>

      <Card
        title="Try a different connection"
        info="Choose how the connection should behave while the Live Feed runs, then watch the Latest updates and the status above. Messages always stay in order and are never shown twice."
      >
        <NetworkControls s={s} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Latest updates"
          info="The newest lines of the live transcript. Lines sent again after a reconnection are marked Recovered."
          actions={
            <Button size="sm" variant="ghost" onClick={live.clearTranscript}>
              Clear
            </Button>
          }
        >
          <LatestUpdates />
        </Card>
        <Card
          title="After a disconnection"
          info="When the connection comes back, CourtScribe tells the server the last update it received, and the server sends everything after it. Anything the server no longer has is counted as not recovered — never silently dropped."
        >
          <RecoveryCard s={s} />
        </Card>
      </div>
    </div>
  );
}
