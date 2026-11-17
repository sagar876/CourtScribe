/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STREAM_URL?: string;
  /** Optional URL of a courtroom audio sample. None is bundled. */
  readonly VITE_SAMPLE_AUDIO_URL?: string;
  /** Minutes after which an active recording shows a memory warning (default 60). */
  readonly VITE_RECORDING_WARN_MINUTES?: string;
  /** Document server base URL; "browser" forces browser-only mode. Defaults to the local server on localhost. */
  readonly VITE_DOC_SERVER_URL?: string;
  readonly VITE_UPLOAD_CHUNK_MB?: string;
  readonly VITE_MAX_UPLOAD_MB?: string;
}
