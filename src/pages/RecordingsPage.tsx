import { Card } from '../components/ui/Card.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { CASE } from '../features/case/caseSession.ts';
import { RecordingLibrary } from '../features/recording/RecordingLibrary.tsx';

export function RecordingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={CASE.reference} title="Recordings" description="Audio recorded in the courtroom on this computer." />
      <Card
        title="Saved recordings"
        info={
          <>
            Your recordings are kept on this computer, in this browser — they are not uploaded anywhere. You can play, download, share, rename or delete them here, even without internet.
            <br />
            <br />
            Download any recording you need to keep: clearing the browser’s data removes them. Record new audio on the <b>Courtroom</b> page.
          </>
        }
      >
        <RecordingLibrary />
      </Card>
      <Card
        title="Playback with transcript"
        className="opacity-90"
        actions={<span title="Planned for a later version" className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-700 uppercase">Future scope</span>}
        info={
          <>
            <b>Coming in a later version.</b> Listen to a recording and follow along in the transcript: the line being spoken is highlighted as the audio plays, and clicking any line jumps
            the audio to that moment — useful for checking exactly how something was said.
            <br />
            <br />
            This needs the transcript to be produced from the recording itself, so that the text and the audio share the same timings. Today the Live Feed and audio recording work separately.
          </>
        }
      >
        <div
          aria-disabled="true"
          title="Future scope — listen to a recording and follow along in the transcript"
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center"
        >
          <p className="text-sm font-medium text-slate-700">Listen to a recording while following the transcript</p>
          <p className="max-w-xl text-xs text-slate-600">
            Planned: play a saved recording, see the line being spoken highlighted, and click any line to hear that moment. To listen to a recording now, use <b>Play</b> under Saved recordings.
          </p>
        </div>
      </Card>
    </div>
  );
}
