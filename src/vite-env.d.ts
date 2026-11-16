/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STREAM_URL?: string;
  /** Optional URL of a courtroom audio sample. None is bundled. */
  readonly VITE_SAMPLE_AUDIO_URL?: string;
  /** Minutes after which an active recording shows a memory warning (default 60). */
  readonly VITE_RECORDING_WARN_MINUTES?: string;
}
