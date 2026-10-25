import type { Lang } from '../core/types';

/** Bilder verkleinern, Audio aufnehmen, Vorlesen. Alles läuft auf dem Gerät. */

const MAX_SIDE = 1600;

/** Verkleinert ein Bild auf höchstens 1600 px und speichert es als WebP (sonst JPEG). */
export async function compressImage(file: Blob): Promise<{ data: ArrayBuffer; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  // Safari kann kein WebP erzeugen und liefert dann PNG: in dem Fall lieber JPEG.
  let blob = await toBlob('image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85);
  if (!blob) throw new Error('image-encode');
  return { data: await blob.arrayBuffer(), mime: blob.type };
}

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

export interface Recorder {
  stop: () => Promise<{ data: ArrayBuffer; mime: string }>;
  cancel: () => void;
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  const end = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = async () => {
          end();
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          resolve({ data: await blob.arrayBuffer(), mime: blob.type });
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      end();
    },
  };
}

const BCP47: Record<Lang, string | null> = { fr: 'fr', de: 'de', en: 'en', it: 'it', es: 'es', other: null };

/**
 * Passende Stimme für eine Sprache. Online-Stimmen (localService = false) schicken den Text
 * an den Anbieter des Browsers; sie werden nur mit ausdrücklicher Erlaubnis verwendet.
 */
export function voiceFor(lang: Lang, allowOnline: boolean): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const code = BCP47[lang];
  if (!code) return null;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(code) && (allowOnline || v.localService));
  // Schweizer Varianten bevorzugen, sonst die Standardstimme der Sprache.
  return voices.find((v) => /-CH$/i.test(v.lang)) ?? voices.find((v) => v.default) ?? voices[0] ?? null;
}

export function speak(text: string, lang: Lang, allowOnline: boolean): boolean {
  const voice = voiceFor(lang, allowOnline);
  if (!voice) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return true;
}

/** Stimmen werden in manchen Browsern erst später geladen. */
export function onVoicesChanged(fn: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => undefined;
  speechSynthesis.addEventListener('voiceschanged', fn);
  return () => speechSynthesis.removeEventListener('voiceschanged', fn);
}
