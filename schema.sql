PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mailboxes (
  address TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mailboxes_expiry ON mailboxes(expires_at);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  from_addr TEXT,
  from_name TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  otp TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (address) REFERENCES mailboxes(address) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_emails_address ON emails(address, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_expiry ON emails(expires_at);

-- Kunci berupa hash IP, bukan IP mentah; dibersihkan setiap lima menit.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);