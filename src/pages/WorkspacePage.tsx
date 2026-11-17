import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { generateTranscript } from '../../shared/transcriptGenerator.ts';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { TranscriptStore } from '../features/transcript/TranscriptStore.ts';
import { AudioEngine } from '../features/audio/AudioEngine.ts';
import { AudioPlayer } from '../features/audio/AudioPlayer.tsx';
import { SPEECH_LANGUAGES, type SpeechStatus } from '../features/speech/SpeechRecognizer.ts';
import { speech, useSpeechState } from '../features/speech/speechSession.ts';
import { CASE } from '../features/case/caseSession.ts';
import { RecordingLibrary } from '../features/recording/RecordingLibrary.tsx';
import { RecordingPanel } from '../features/recording/RecordingPanel.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { KeyValueGrid } from '../components/ui/KeyValueGrid.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusIndicator } from '../components/ui/StatusIndicator.tsx';
import { describeConnection } from '../features/realtime/connectionStatus.ts';
import { live, liveTranscript, useLiveSnapshot } from '../features/realtime/liveSession.ts';
import { TranscriptViewer } from '../features/transcript/TranscriptViewer.tsx';
import { formatNumber, formatTimestamp } from '../lib/format.ts';


function LiveTranscriptStats() {
  useSyncExternalStore(liveTranscript.subscribe, liveTranscript.getVersion);
  const last = liveTranscript.at(liveTranscript.size - 1);
  return (
    <span className="tabular font-mono text-xs text-slate-500">
      {formatNumber(liveTranscript.size)} segments{last ? ` · up to ${formatTimestamp(last.endTime)}` : ''}
    </span>
  );
}

const SPEECH_STATUS: Record<SpeechStatus, { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; label: string }> = {
  idle: { tone: 'neutral', label: 'Not listening' },
  requesting: { tone: 'info', label: 'Waiting for microphone permission…' },
  listening: { tone: 'success', label: 'Listening' },
  restarting: { tone: 'info', label: 'Listening (restarting recognition…)' },
  stopping: { tone: 'info', label: 'Finishing the last phrase…' },
  error: { tone: 'danger', label: 'Speech recognition stopped' },
};

/** Live Feed: microphone speech recognition and the server connection, with separate statuses. */
function LiveFeedCard() {
  const s = useLiveSnapshot();
  const sp = useSpeechState();
  const conn = describeConnection(s);
  const status = SPEECH_STATUS[sp.status];
  const listening = sp.status === 'listening' || sp.status === 'restarting' || sp.status === 'requesting' || sp.status === 'stopping';
  const simulatorRunning = s.server?.config.running ?? false;
  return (
    <Card
      title="Live Feed"
      description="Speak into this device’s microphone: recognised words appear in the transcript below. Browser-based speech recognition (proof of concept) — not a production transcription engine, and speakers are not identified."
      className="h-full"
    >
      <div className="flex flex-col gap-4" data-tour="live-feed">
        <section aria-label="Speech recognition" className="flex flex-col gap-2">
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
                Recognition language
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
                <Button variant="primary" icon={<Icon name="mic" />} onClick={() => {
                    live.connect(); // recognised text travels through the Live Feed server
                    void speech.start();
                  }}
                  disabled={Boolean(s.configError)} title={s.configError ?? undefined}>
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
          {sp.supported && (
            <p className="text-[11px] leading-relaxed text-slate-500">
              Uses the browser’s Web Speech API. In Chrome and Edge, audio is sent to the browser vendor’s online speech service, so an internet connection is required and the audio leaves this device. Independent of
              Audio recording: the saved recording is not transcribed.
            </p>
          )}
        </section>

        <section aria-label="Live Feed server" className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Live Feed server</span>
            <StatusIndicator tone={conn.tone} label={conn.label} pulse={false} className="text-xs" />
          </div>
          <p className="text-xs text-slate-500" title={conn.detail}>
            {conn.detail}
            {s.speechOutbox > 0 && ` · ${s.speechOutbox} recognised phrase${s.speechOutbox === 1 ? '' : 's'} waiting to be sent`}
          </p>
          <div className="font-mono text-[11px] text-slate-500">
            Case {CASE.reference} · stream session {s.sessionId ?? '—'}
          </div>
          {s.sessionRestarted && (
            <p className="text-xs text-amber-700" role="status">
              The Live Feed server restarted with a new session, so the live transcript started again from the beginning.
            </p>
          )}
          {simulatorRunning && (
            <p className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
              The synthetic dialogue simulator (Performance Lab) is also running, so generated lines are mixed into this feed.
              <Button size="sm" onClick={() => live.configureServer({ running: false })}>
                Stop simulator
              </Button>
            </p>
          )}
          {!s.configError && !s.localMode && (
            <div className="flex flex-wrap gap-2">
              {s.state === 'disconnected' ? (
                <Button size="sm" icon={<Icon name="plug" />} onClick={live.connect}>
                  Connect
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={live.disconnect}>
                    Disconnect
                  </Button>
                  <Button size="sm" onClick={live.reconnectNow}>
                    Reconnect
                  </Button>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}

type TranscriptSource = 'live' | 10_000 | 100_000;

export function WorkspacePage() {
  const [{ source, store }, setSelection] = useState<{ source: TranscriptSource; store: TranscriptStore }>({ source: 'live', store: liveTranscript });
  // Recorded-session transcripts start at 00:00 so they line up with any recording; built on first use, kept for this visit.
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

  // One engine per Workspace visit; disposed (audio, listeners, waveform, object URL) on leave.
  const [audio] = useState(() => new AudioEngine());
  useEffect(() => () => audio.dispose(), [audio]);
  useEffect(() => audio.setTimeline(store), [audio, store]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={CASE.reference}
        title="Courtroom Workspace"
        description={`${CASE.session} · ${CASE.court}`}
        actions={
          <>
            <Button icon={<Icon name="download" />} unavailableReason="Transcript export is not implemented yet">
              Export
            </Button>
            <Button icon={<Icon name="check" />} unavailableReason="Transcript certification is not implemented yet">
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
                  {CASE.language} <Badge>ml-IN</Badge>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Audio recording" description="Captures audio from a microphone on this device. Independent of the transcript stream." className="h-full">
          <RecordingPanel />
        </Card>
        <LiveFeedCard />
      </div>

      <Card title="Saved recordings" description="Recordings stored on this device. They play offline, without the transcript server.">
        <RecordingLibrary onOpenWithTranscript={(r) => audio.loadUrl(r.url, r.name)} />
      </Card>

      <Card title="Playback" description="Play a recording or a local audio file, synchronised with the transcript by segment start time. Click a segment to seek to it.">
        <AudioPlayer engine={audio} store={store} />
      </Card>

      <Card
        title="Transcript"
        description={
          source === 'live'
            ? 'Recognised speech from the Live Feed, via the Node server. Times are relative to the server session. Interim rows update as you speak and become Final.'
            : 'Synthetic recorded session starting at 00:00 — use it to check audio synchronisation.'
        }
        actions={
          <SegmentedControl<TranscriptSource>
            label="Source"
            value={source}
            onChange={selectSource}
            options={[
              { value: 'live', label: 'Live feed' },
              { value: 10_000, label: 'Recorded · 10K' },
              { value: 100_000, label: 'Recorded · 100K' },
            ]}
          />
        }
        bodyClassName="p-0"
      >
        <div className="p-4">
          <TranscriptViewer key={String(source)} store={store} live={source === 'live'} playback={audio} listClassName="h-[clamp(360px,60vh,720px)]" />
        </div>
      </Card>
    </div>
  );
}
