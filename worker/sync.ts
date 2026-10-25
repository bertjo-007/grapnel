/**
 * Sync-Endpunkte. Der Server kennt keine Benutzer und keine Inhalte: nur Räume (zufällige
 * IDs), den Hash eines Zugangs-Tokens und verschlüsselte Pakete in fester Reihenfolge.
 * Die Logik hängt nur an der SyncStore-Schnittstelle, damit sie ohne D1 testbar ist.
 */

export interface StoredPacket {
  seq: number;
  id: string;
  device: string;
  iv: string;
  data: string;
}

export interface SyncStore {
  roomAuth(room: string): Promise<string | null>;
  createRoom(room: string, authHash: string): Promise<void>;
  insertPackets(room: string, packets: Omit<StoredPacket, 'seq'>[]): Promise<void>;
  packetsAfter(room: string, after: number, limit: number): Promise<StoredPacket[]>;
  deleteRoom(room: string): Promise<void>;
}

const MAX_PACKETS = 20;
const MAX_DATA = 1_900_000;
const PULL_LIMIT = 50;
const ROOM_RE = /^[0-9a-f]{32}$/;
const SAFE = /^[A-Za-z0-9_-]+$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenOf(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : null;
}

/** Prüft den Zugang. createIfMissing: Der erste Upload legt den Raum an. */
async function authorize(store: SyncStore, room: string, token: string | null, createIfMissing: boolean): Promise<Response | null> {
  if (!ROOM_RE.test(room)) return json({ error: 'bad-room' }, 400);
  if (!token) return json({ error: 'no-token' }, 401);
  const hash = await sha256(token);
  const known = await store.roomAuth(room);
  if (known === null) {
    if (!createIfMissing) return null;
    await store.createRoom(room, hash);
    return null;
  }
  return known === hash ? null : json({ error: 'forbidden' }, 403);
}

export async function handleSync(req: Request, store: SyncStore): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const token = tokenOf(req);

  if (path === '/api/sync/push' && req.method === 'POST') {
    let body: { room?: string; packets?: { id?: string; device?: string; iv?: string; data?: string }[] };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad-json' }, 400);
    }
    const room = body.room ?? '';
    const denied = await authorize(store, room, token, true);
    if (denied) return denied;
    const packets = body.packets ?? [];
    if (!Array.isArray(packets) || packets.length > MAX_PACKETS) return json({ error: 'too-many' }, 413);
    const clean: Omit<StoredPacket, 'seq'>[] = [];
    for (const p of packets) {
      if (!p.id || !p.device || !p.iv || !p.data) return json({ error: 'bad-packet' }, 400);
      if (p.id.length > 64 || p.device.length > 64 || !SAFE.test(p.iv) || p.data.length > MAX_DATA) return json({ error: 'bad-packet' }, 400);
      clean.push({ id: p.id, device: p.device, iv: p.iv, data: p.data });
    }
    await store.insertPackets(room, clean);
    return json({ ok: true, stored: clean.length });
  }

  if (path === '/api/sync/pull' && req.method === 'GET') {
    const room = url.searchParams.get('room') ?? '';
    const after = Math.max(0, parseInt(url.searchParams.get('after') ?? '0', 10) || 0);
    const denied = await authorize(store, room, token, false);
    if (denied) return denied;
    if ((await store.roomAuth(room)) === null) return json({ packets: [], more: false });
    const rows = await store.packetsAfter(room, after, PULL_LIMIT + 1);
    return json({ packets: rows.slice(0, PULL_LIMIT), more: rows.length > PULL_LIMIT });
  }

  if (path === '/api/sync/room' && req.method === 'DELETE') {
    const room = url.searchParams.get('room') ?? '';
    const denied = await authorize(store, room, token, false);
    if (denied) return denied;
    await store.deleteRoom(room);
    return json({ ok: true });
  }

  return json({ error: 'not-found' }, 404);
}

/** Speicher im Arbeitsspeicher, für Tests und die lokale Entwicklung ohne D1. */
export class MemoryStore implements SyncStore {
  rooms = new Map<string, string>();
  packets: (StoredPacket & { room: string })[] = [];
  private seq = 0;

  async roomAuth(room: string) {
    return this.rooms.get(room) ?? null;
  }
  async createRoom(room: string, authHash: string) {
    this.rooms.set(room, authHash);
  }
  async insertPackets(room: string, packets: Omit<StoredPacket, 'seq'>[]) {
    for (const p of packets) {
      if (this.packets.some((x) => x.room === room && x.id === p.id)) continue;
      this.packets.push({ ...p, room, seq: ++this.seq });
    }
  }
  async packetsAfter(room: string, after: number, limit: number) {
    return this.packets
      .filter((p) => p.room === room && p.seq > after)
      .slice(0, limit)
      .map(({ room: _r, ...p }) => p);
  }
  async deleteRoom(room: string) {
    this.rooms.delete(room);
    this.packets = this.packets.filter((p) => p.room !== room);
  }
}
