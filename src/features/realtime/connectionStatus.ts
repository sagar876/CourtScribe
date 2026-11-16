import type { Tone } from '../../components/ui/Badge.tsx';
import type { LiveSnapshot } from './liveSession.ts';

export function describeConnection(s: LiveSnapshot): { tone: Tone; label: string; detail: string; pulse: boolean } {
  switch (s.state) {
    case 'disconnected':
      return { tone: 'neutral', label: 'Disconnected', detail: 'Live feed is off.', pulse: false };
    case 'connecting':
      return { tone: 'info', label: 'Connecting…', detail: 'Opening WebSocket.', pulse: true };
    case 'syncing':
      return {
        tone: 'info',
        label: 'Syncing',
        detail: `Replaying missed events: #${s.lastProcessedSeq.toLocaleString()} of #${(s.syncTargetSeq ?? 0).toLocaleString()}`,
        pulse: true,
      };
    case 'connected':
      return s.server?.config.running
        ? { tone: 'success', label: 'Connected · live', detail: `Receiving ${s.incomingPerSecond} events/s`, pulse: true }
        : { tone: 'success', label: 'Connected', detail: 'Simulator stopped on the server.', pulse: false };
    case 'reconnecting': {
      const retry = s.nextRetryInMs !== null ? `retry in ${(s.nextRetryInMs / 1000).toFixed(1)} s` : 'retrying now';
      return { tone: 'warning', label: 'Reconnecting', detail: `Attempt ${s.currentAttempt} · ${retry}${s.lastError ? ` · ${s.lastError}` : ''}`, pulse: true };
    }
  }
}
