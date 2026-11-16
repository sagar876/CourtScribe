import { SPEAKERS, type SpeakerId, type TranscriptSegment } from './transcript.ts';

/** Small, fast, deterministic PRNG so datasets are reproducible between runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUESTIONS = [
  'നിങ്ങളുടെ പേരും വിലാസവും പറയാമോ?',
  'സംഭവം നടന്ന ദിവസം നിങ്ങൾ എവിടെയായിരുന്നു?',
  'പ്രതിയെ നിങ്ങൾക്ക് മുൻപ് പരിചയമുണ്ടോ?',
  'ആ സമയത്ത് വെളിച്ചം ഉണ്ടായിരുന്നോ?',
  'Exhibit P3 നിങ്ങൾ മുൻപ് കണ്ടിട്ടുണ്ടോ?',
  'പോലീസ് നിങ്ങളുടെ മൊഴി എപ്പോഴാണ് രേഖപ്പെടുത്തിയത്?',
  'നിങ്ങൾ പറയുന്നത് സത്യമാണോ?',
  'ആ വാഹനത്തിന്റെ നിറം ഓർമ്മയുണ്ടോ?',
  'Exhibit P5 ലെ ഒപ്പ് നിങ്ങളുടേതാണോ?',
  'സംഭവസ്ഥലത്ത് നിന്ന് നിങ്ങളുടെ വീട്ടിലേക്ക് എത്ര ദൂരമുണ്ട്?',
  'ആരാണ് ആദ്യം പോലീസിനെ വിവരം അറിയിച്ചത്?',
  'ആ രാത്രി നിങ്ങൾ എന്തെങ്കിലും ശബ്ദം കേട്ടോ?',
];

const ANSWERS = [
  'എന്റെ പേര് രാജേഷ് കുമാർ, കാക്കനാട് താമസിക്കുന്നു.',
  'ഞാൻ വീട്ടിൽ ഉണ്ടായിരുന്നു.',
  'ഇല്ല, എനിക്ക് അദ്ദേഹത്തെ പരിചയമില്ല.',
  'അതെ, തെരുവുവിളക്ക് കത്തുന്നുണ്ടായിരുന്നു.',
  'ആ സമയത്ത് ഏകദേശം രാത്രി എട്ടു മണി ആയിരുന്നു.',
  'എനിക്ക് കൃത്യമായി ഓർമ്മയില്ല.',
  'അതെ, ഞാൻ പറയുന്നത് സത്യമാണ്.',
  'ആ വാഹനത്തിന്റെ നിറം വെള്ളയായിരുന്നു.',
  'ഈ ഒപ്പ് എന്റേതാണ്.',
  'ഞാൻ ശബ്ദം കേട്ട് പുറത്തേക്ക് ഇറങ്ങി.',
  'പോലീസ് പിറ്റേ ദിവസം രാവിലെ എന്റെ മൊഴി രേഖപ്പെടുത്തി.',
  'ഏകദേശം അര കിലോമീറ്റർ ദൂരമുണ്ട്.',
  'അയൽവാസിയാണ് പോലീസിനെ വിളിച്ചത്.',
];

const BENCH = [
  'ഒബ്ജക്ഷൻ നിരസിച്ചിരിക്കുന്നു. തുടരുക.',
  'സാക്ഷിയുടെ ഉത്തരം രേഖപ്പെടുത്തുക.',
  'ഒബ്ജക്ഷൻ അനുവദിച്ചിരിക്കുന്നു. ചോദ്യം മാറ്റി ചോദിക്കുക.',
  'ക്രോസ് വിസ്താരം ആരംഭിക്കാം.',
  'Exhibit P3 സാക്ഷിയെ കാണിക്കുന്നു.',
];

const OBJECTIONS = [
  'ഒബ്ജക്ഷൻ, ഈ ചോദ്യം സാക്ഷിയെ നയിക്കുന്നതാണ്.',
  'ഒബ്ജക്ഷൻ, ഇത് കേസുമായി ബന്ധമില്ലാത്ത ചോദ്യമാണ്.',
];

const CLERK = ['Exhibit P5 അടയാളപ്പെടുത്തി.', 'സാക്ഷി സത്യപ്രതിജ്ഞ ചെയ്തു.'];

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

/**
 * Stateful generator that produces a plausible question/answer rhythm of a
 * witness deposition. Used by both the dataset builder and the WS server.
 */
export class TranscriptGenerator {
  private rng: () => number;
  private cursorMs = 0;
  private examiner: SpeakerId = 'pp';
  private turn = 0;

  constructor(seed = 421) {
    this.rng = mulberry32(seed);
  }

  next(sequenceNumber: number): TranscriptSegment {
    const rng = this.rng;
    let speakerId: SpeakerId;
    let text: string;
    const roll = rng();

    if (this.turn % 2 === 0) {
      if (roll < 0.06) {
        speakerId = 'judge';
        text = pick(rng, BENCH);
        if (text.startsWith('ക്രോസ്')) this.examiner = this.examiner === 'pp' ? 'dc' : 'pp';
      } else if (roll < 0.09) {
        speakerId = 'clerk';
        text = pick(rng, CLERK);
      } else if (roll < 0.13) {
        speakerId = this.examiner === 'pp' ? 'dc' : 'pp';
        text = pick(rng, OBJECTIONS);
      } else {
        speakerId = this.examiner;
        text = pick(rng, QUESTIONS);
        this.turn++;
      }
    } else {
      speakerId = 'pw1';
      text = pick(rng, ANSWERS);
      if (rng() < 0.35) text += ' ' + pick(rng, ANSWERS);
      this.turn++;
    }

    const duration = 1200 + Math.round(text.length * 55 * (0.8 + rng() * 0.4));
    const startTime = this.cursorMs + 200 + Math.round(rng() * 900);
    const endTime = startTime + duration;
    this.cursorMs = endTime;

    return {
      id: `seg-${sequenceNumber}`,
      speakerId,
      speakerName: SPEAKERS[speakerId],
      text,
      startTime,
      endTime,
      confidence: Math.round((0.72 + rng() * 0.28) * 1000) / 1000,
      sequenceNumber,
    };
  }
}

export function generateTranscript(count: number, seed = 421): TranscriptSegment[] {
  const gen = new TranscriptGenerator(seed);
  const out = new Array<TranscriptSegment>(count);
  for (let i = 0; i < count; i++) out[i] = gen.next(i + 1);
  return out;
}
