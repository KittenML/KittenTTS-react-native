CREATE TABLE IF NOT EXISTS raw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_date TEXT NOT NULL,
  anonymous_id_hash TEXT NOT NULL,
  sdk_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_runtime TEXT NOT NULL,
  react_native_version TEXT,
  model TEXT,
  voice TEXT,
  playback_helper TEXT,
  asset_source TEXT,
  cache_hit INTEGER,
  error_code TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_raw_events_received_at
  ON raw_events(received_at);

CREATE INDEX IF NOT EXISTS idx_raw_events_name_date
  ON raw_events(event_name, event_date);

CREATE TABLE IF NOT EXISTS daily_metrics (
  event_date TEXT NOT NULL,
  event_name TEXT NOT NULL,
  sdk_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_runtime TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  voice TEXT NOT NULL DEFAULT '',
  playback_helper TEXT NOT NULL DEFAULT '',
  asset_source TEXT NOT NULL DEFAULT '',
  cache_hit INTEGER NOT NULL DEFAULT -1,
  error_code TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (
    event_date,
    event_name,
    sdk_version,
    platform,
    app_runtime,
    model,
    voice,
    playback_helper,
    asset_source,
    cache_hit,
    error_code
  )
);
