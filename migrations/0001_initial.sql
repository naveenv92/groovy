PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL UNIQUE, speed REAL NOT NULL DEFAULT 1, skip_back INTEGER NOT NULL DEFAULT 15, skip_forward INTEGER NOT NULL DEFAULT 30);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE subscriptions (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, url TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, artwork TEXT NOT NULL, PRIMARY KEY(user_id,url));
CREATE TABLE progress (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, episode_id TEXT NOT NULL, position REAL NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(user_id,episode_id));
CREATE TABLE login_attempts (ip_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
