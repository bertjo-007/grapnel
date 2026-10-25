/**
 * Schlüssel und Verschlüsselung für den Sync. Ein Gerät erzeugt 32 Zufallsbytes; daraus
 * werden mit HKDF drei unabhängige Werte abgeleitet:
 *   - Raum-ID: unter welcher Adresse die Pakete liegen (verrät nichts über den Inhalt),
 *   - Zugangs-Token: beweist dem Server, dass man schreiben und lesen darf,
 *   - AES-GCM-Schlüssel: verschlüsselt die Pakete. Er verlässt das Gerät nie.
 * Der Server sieht also nur Raum-ID, Hash des Tokens und unlesbare Pakete.
 */

const enc = new TextEncoder();
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Schlüssel als lesbarer Code: Crockford-Base32 in Vierergruppen. */
export function encodeCode(key: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of key) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function decodeCode(code: string): Uint8Array | null {
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return bytes.length === 32 ? new Uint8Array(bytes) : null;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SyncKeys {
  roomId: string;
  authToken: string;
  encKey: CryptoKey;
}

export async function deriveKeys(key: Uint8Array): Promise<SyncKeys> {
  const base = await crypto.subtle.importKey('raw', key as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('grapnel-sync-v1'), info: enc.encode(info) });
  const room = await crypto.subtle.deriveBits(params('room'), base, 128);
  const auth = await crypto.subtle.deriveBits(params('auth'), base, 256);
  const encKey = await crypto.subtle.deriveKey(params('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { roomId: hex(room), authToken: toBase64Url(new Uint8Array(auth)), encKey };
}

async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<{ iv: string; data: string }> {
  const raw = enc.encode(JSON.stringify(value));
  const packed = typeof CompressionStream === 'function' ? await transform(raw, new CompressionStream('gzip')) : raw;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, packed as BufferSource);
  // Erstes Byte im Klartext-Kopf: 1 = gzip, 0 = roh.
  const flag = typeof CompressionStream === 'function' ? 'g' : 'r';
  return { iv: toBase64Url(iv), data: flag + toBase64Url(new Uint8Array(cipher)) };
}

export async function decryptJson<T>(key: CryptoKey, iv: string, data: string): Promise<T> {
  const flag = data[0];
  const cipher = fromBase64Url(data.slice(1));
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) as BufferSource }, key, cipher as BufferSource));
  const raw = flag === 'g' ? await transform(plain, new DecompressionStream('gzip')) : plain;
  return JSON.parse(new TextDecoder().decode(raw)) as T;
}
