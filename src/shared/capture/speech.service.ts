import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

export type SpeechError = 'denied' | 'unavailable' | 'no-speech' | 'aborted';

const LANGUAGES = ['es-DO', 'es-419', 'es'];

interface WebRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type WebRecognitionCtor = new () => WebRecognition;

const fail = (code: SpeechError): Error => new Error(code);

const webCtor = (): WebRecognitionCtor | null => {
  const w = globalThis as unknown as { SpeechRecognition?: WebRecognitionCtor; webkitSpeechRecognition?: WebRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// Voice input for the capture flow. Only the transcript leaves the recognizer: nothing is recorded,
// stored or sent by this app. The native plugin is imported on first use to keep it out of the main bundle.
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private web: WebRecognition | null = null;
  private stopped = false;

  private async plugin() {
    return (await import('@capacitor-community/speech-recognition')).SpeechRecognition;
  }

  async available(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try {
        return (await (await this.plugin()).available()).available;
      } catch {
        return false;
      }
    }
    return webCtor() !== null;
  }

  // Resolves with the final transcript; rejects with Error('denied' | 'unavailable' | 'no-speech' | 'aborted')
  async listen(): Promise<string> {
    this.stopped = false;
    for (let i = 0; i < LANGUAGES.length; i++) {
      try {
        return Capacitor.isNativePlatform() ? await this.listenNative(LANGUAGES[i]) : await this.listenWeb(LANGUAGES[i]);
      } catch (error) {
        // only an unsupported language moves on to the next one
        if ((error as Error).message === 'language') continue;
        throw error;
      }
    }
    throw fail('unavailable');
  }

  stop(): void {
    this.stopped = true;
    this.web?.stop();
    if (Capacitor.isNativePlatform()) void this.plugin().then((p) => p.stop()).catch(() => undefined);
  }

  private async listenNative(language: string): Promise<string> {
    const p = await this.plugin();
    let status = await p.checkPermissions();
    // the permission is asked only now, at the first use
    if (status.speechRecognition !== 'granted') status = await p.requestPermissions();
    if (status.speechRecognition !== 'granted') throw fail('denied');
    try {
      const { matches } = await p.start({ language, maxResults: 1, partialResults: false, popup: false });
      const text = (matches?.[0] ?? '').trim();
      if (!text) throw fail(this.stopped ? 'aborted' : 'no-speech');
      return text;
    } catch (error) {
      if (error instanceof Error && ['denied', 'unavailable', 'no-speech', 'aborted'].includes(error.message)) throw error;
      const msg = String((error as { message?: string })?.message ?? '').toLowerCase();
      if (msg.includes('language')) throw new Error('language');
      if (msg.includes('permission')) throw fail('denied');
      if (msg.includes('no match') || msg.includes('speech timeout') || msg.includes('no speech')) throw fail('no-speech');
      throw fail(this.stopped ? 'aborted' : 'unavailable');
    }
  }

  private listenWeb(language: string): Promise<string> {
    const Ctor = webCtor();
    if (!Ctor) return Promise.reject(fail('unavailable'));
    return new Promise<string>((resolve, reject) => {
      const rec = new Ctor();
      this.web = rec;
      rec.lang = language;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      let text = '';
      let error: string | null = null;
      rec.onresult = (e) => {
        text = Array.from(e.results, (r) => r[0]?.transcript ?? '').join(' ').trim();
      };
      rec.onerror = (e) => {
        error = e.error;
      };
      rec.onend = () => {
        this.web = null;
        if (text) return resolve(text);
        if (this.stopped || error === 'aborted') return reject(fail('aborted'));
        if (error === 'not-allowed' || error === 'service-not-allowed') return reject(fail('denied'));
        if (error === 'language-not-supported') return reject(new Error('language'));
        if (error === 'no-speech' || error === null) return reject(fail('no-speech'));
        reject(fail('unavailable'));
      };
      try {
        rec.start();
      } catch {
        this.web = null;
        reject(fail('unavailable'));
      }
    });
  }
}
