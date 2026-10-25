-- Sync-Speicher von Grapnel. Enthält nur verschlüsselte Pakete, nie Klartext.
CREATE TABLE IF NOT EXISTS rooms (
  room TEXT PRIMARY KEY,
  auth_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packets (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  id TEXT NOT NULL,
  device TEXT NOT NULL,
  iv TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (room, id)
);

CREATE INDEX IF NOT EXISTS packets_room_seq ON packets (room, seq);
