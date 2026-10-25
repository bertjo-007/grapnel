import { handleSync, type StoredPacket, type SyncStore } from './sync';

/**
 * Grapnel-Worker: liefert die App aus (Static Assets) und beantwortet /api/sync/*.
 * Alles andere ist reine Client-Logik; ohne eingeschalteten Sync spricht die App nie
 * mit diesem Worker ausser zum Laden der Dateien.
 */

interface Env {
  DB: D1Database;
}

class D1Store implements SyncStore {
  constructor(private db: D1Database) {}

  async roomAuth(room: string) {
    const row = await this.db.prepare('SELECT auth_hash FROM rooms WHERE room = ?').bind(room).first<{ auth_hash: string }>();
    return row?.auth_hash ?? null;
  }

  async createRoom(room: string, authHash: string) {
    await this.db.prepare('INSERT OR IGNORE INTO rooms (room, auth_hash, created_at) VALUES (?, ?, ?)').bind(room, authHash, Date.now()).run();
  }

  async insertPackets(room: string, packets: Omit<StoredPacket, 'seq'>[]) {
    if (!packets.length) return;
    const now = Date.now();
    const stmt = this.db.prepare('INSERT OR IGNORE INTO packets (room, id, device, iv, data, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    await this.db.batch(packets.map((p) => stmt.bind(room, p.id, p.device, p.iv, p.data, now)));
  }

  async packetsAfter(room: string, after: number, limit: number) {
    const res = await this.db
      .prepare('SELECT seq, id, device, iv, data FROM packets WHERE room = ? AND seq > ? ORDER BY seq LIMIT ?')
      .bind(room, after, limit)
      .all<StoredPacket>();
    return res.results ?? [];
  }

  async deleteRoom(room: string) {
    await this.db.batch([this.db.prepare('DELETE FROM packets WHERE room = ?').bind(room), this.db.prepare('DELETE FROM rooms WHERE room = ?').bind(room)]);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/sync/')) {
      try {
        return await handleSync(request, new D1Store(env.DB));
      } catch {
        return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }
    if (url.pathname === '/api/health') return new Response('ok');
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
