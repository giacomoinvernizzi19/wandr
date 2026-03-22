-- Wandr schema

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  picture TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  share_slug TEXT UNIQUE,
  destination TEXT NOT NULL,
  destination_lat REAL,
  destination_lng REAL,
  start_date TEXT,
  end_date TEXT,
  num_days INTEGER NOT NULL,
  preferences_json TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','generating','complete')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE trip_days (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  date TEXT,
  activities_json TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(trip_id, day_number)
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_trips_user ON trips(user_id);
CREATE INDEX idx_trips_share ON trips(share_slug);
CREATE INDEX idx_trip_days_trip ON trip_days(trip_id);
