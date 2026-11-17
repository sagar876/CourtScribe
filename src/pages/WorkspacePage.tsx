import { useRef, useState, useSyncExternalStore } from 'react';
import { generateTranscript } from '../../shared/transcriptGenerator.ts';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { TranscriptStore } from '../features/transcript/TranscriptStore.ts';
import { SPEECH_LANGUAGES, type SpeechStatus } from '../features/speech/SpeechRecognizer.ts';
import { speech, useSpeechState } from '../features/speech/speechSession.ts';
import { CASE } from '../features/case/caseSession.ts';
import { RecordingPanel } from '../features/recording/RecordingPanel.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { KeyValueGrid } from '../components/ui/KeyValueGrid.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusIndicator } from '../components/ui/StatusIndicator.tsx';
import { live, liveTranscript, useLiveSnapshot } from '../features/realtime/liveSession.ts';
import { TranscriptViewer } from '../features/transcript/TranscriptViewer.tsx';


function LiveTranscriptStats() {
  useSyncExternalStore(liveTranscript.subscribe, liveTranscript.getVersion);
  const n = liveTranscript.size;
  return <span className="tabular text-xs text-slate-500">{n.toLocaleString('en-IN')} {n === 1 ? 'line' : 'lines'}</span>;
}

const SPEECH_STATUS: Record<SpeechStatus, { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; label: string }> = {
  idle: { tone: 'neutral', label: 'Not listening' },
  requesting: { tone: 'info', label: 'Waiting for microphone permission…' },
  listening: { tone: 'success', label: 'Listening' },
  restarting: { tone: 'success', label: 'Listening' },
  stopping: { tone: 'info', label: 'Finishing the last phrase…' },
  error: { tone: 'danger', label: 'Speech recognition stopped' },
};

/**
 * Live Feed: one place to start/stop speech recognition. The feed connection is a single status line
 * underneath (it connects automatically on Start Listening; local mode needs no server).
 */
function LiveFeedCard() {
  const s = useLiveSnapshot();
  const sp = useSpeechState();
  const status = SPEECH_STATUS[sp.status];
  const listening = sp.status === 'listening' || sp.status === 'restarting' || sp.status === 'requesting' || sp.status === 'stopping';
  const simulatorRunning = s.server?.config.running ?? false;
  const serverMode = !s.localMode && !s.configError;
  // Only connection problems are worth mentioning to the user; local mode needs no status line at all.
  const feedLine = s.configError
    ? 'The Live Feed is not available on this site at the moment.'
    : s.localMode || s.state === 'disconnected'
      ? null
      : s.state === 'reconnecting'
        ? 'Connection lost — reconnecting automatically…'
        : s.state === 'syncing'
          ? 'Catching up after a short disconnection…'
          : s.state === 'connecting'
            ? 'Connecting…'
            : null;
  return (
    <Card
      title="Live Feed"
      info={
        <>
          Turns speech into text as you talk. Choose the language, press <b>Start Listening</b> and speak — your words appear in the <b>Transcript</b> below.
          <br />
          <br />
          Works in Google Chrome or Microsoft Edge with an internet connection: the browser sends the speech to its own online service to recognise it. Speakers are not identified
          automatically. This is separate from audio recording — saved recordings are not transcribed.
        </>
      }
      className="h-full"
    >
      <div className="flex flex-col gap-3" data-tour="live-feed">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusIndicator tone={status.tone} label={status.label} pulse={sp.status === 'listening'} />
          <LiveTranscriptStats />
        </div>

        {!sp.supported ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
            {sp.unsupportedReason}
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-slate-600 uppercase">
              Language
              <select
                value={sp.lang}
                onChange={(e) => speech.setLang(e.target.value)}
                disabled={listening}
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal tracking-normal text-slate-800 normal-case disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
              >
                {SPEECH_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            {listening ? (
              <Button variant="primary" onClick={speech.stop} disabled={sp.status === 'stopping'}>
                ■ Stop Listening
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={<Icon name="mic" />}
                onClick={() => {
                  live.connect(); // server mode: recognised text travels through the Live Feed server
                  void speech.start();
                }}
                disabled={Boolean(s.configError)}
                title={s.configError ?? undefined}
              >
                Start Listening
              </Button>
            )}
          </div>
        )}

        {sp.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
            {sp.error}
          </p>
        )}

        {(feedLine || s.speechOutbox > 0) && (
          <p className="text-xs text-amber-800" role="status">
            {feedLine}
            {s.speechOutbox > 0 && ` ${s.speechOutbox} phrase${s.speechOutbox === 1 ? '' : 's'} will appear once the connection is back.`}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          {serverMode && (s.state === 'reconnecting' || s.state === 'syncing') && (
            <span className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={live.reconnectNow}>
                Reconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={live.disconnect}>
                Disconnect
              </Button>
            </span>
          )}
        </div>

        {s.sessionRestarted && (
          <p className="text-xs text-amber-700" role="status">
            The Live Feed restarted, so the transcript started again from the beginning.
          </p>
        )}
        {simulatorRunning && (
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
            Sample test dialogue is also being added to this transcript (started from the Performance Lab).
            <Button size="sm" onClick={() => live.configureServer({ running: false })}>
              Stop simulator
            </Button>
          </p>
        )}
      </div>
    </Card>
  );
}

type TranscriptSource = 'live' | 100_000;

export function WorkspacePage() {
  const [{ source, store }, setSelection] = useState<{ source: TranscriptSource; store: TranscriptStore }>({ source: 'live', store: liveTranscript });
  // The 100K sample shows that very long hearings stay fast (virtualised list); built on first use, kept for this visit.
  const recorded = useRef(new Map<number, TranscriptStore>());
  const selectSource = (next: TranscriptSource) => {
    if (next === 'live') return setSelection({ source: next, store: liveTranscript });
    let s = recorded.current.get(next);
    if (!s) {
      s = new TranscriptStore(generateTranscript(next));
      recorded.current.set(next, s);
    }
    setSelection({ source: next, store: s });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={CASE.reference}
        title="Courtroom"
        description={`${CASE.session} · ${CASE.court}`}
        actions={
          <>
            <Button icon={<Icon name="download" />} futureScope>
              Export
            </Button>
            <Button icon={<Icon name="check" />} futureScope>
              Certify transcript
            </Button>
          </>
        }
      />

      <Card title="Case details">
        <KeyValueGrid
          items={[
            { label: 'Case reference', value: <span className="font-mono">{CASE.reference}</span> },
            { label: 'Court', value: CASE.court },
            { label: 'Session', value: CASE.session },
            {
              label: 'Language',
              value: (
                <span className="flex items-center gap-2">
                  {CASE.language}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Audio recording"
          info={
            <>
              Record the hearing with this computer’s microphone. Choose a microphone and press <b>Start Recording</b> — a red bar at the top of the screen shows that recording is on. You can pause and
              resume. When you stop, the recording is saved on this computer and appears on the <b>Recordings</b> page.
              <br />
              <br />
              Microphone names appear after you allow microphone access the first time. Please make sure recording is permitted in your court.
            </>
          }
          className="h-full"
        >
          <RecordingPanel />
        </Card>
        <LiveFeedCard />
      </div>

      <Card
        title="Transcript"
        info={
          <>
            Everything recognised by the Live Feed appears here, newest at the bottom. <b>Interim</b> lines may still change while someone is speaking; they become <b>Final</b> when the sentence
            is complete. Search for a word, jump to a time, or click a line to see its details. If you scroll up to read, new lines won’t move the page — use <b>Jump to latest</b> to return.
            <br />
            <br />
            <b>Sample: 100,000 lines</b> loads a made-up transcript about the length of several full days of hearings, to show that searching and scrolling stay instant however long a
            transcript gets. It is sample data, not a real case.
          </>
        }
        actions={
          <SegmentedControl<TranscriptSource>
            label="Source"
            value={source}
            onChange={selectSource}
            options={[
              { value: 'live', label: 'Live Feed' },
              { value: 100_000, label: 'Sample: 100,000 lines', title: 'Sample transcript (not a real hearing) showing that very long transcripts stay fast' },
            ]}
          />
        }
        bodyClassName="p-0"
      >
        <div className="p-4">
          <TranscriptViewer key={String(source)} store={store} live={source === 'live'} listClassName="h-[clamp(360px,60vh,720px)]" />
        </div>
      </Card>
    </div>
  );
}
