CREATE TABLE podcast_speeds (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, url TEXT NOT NULL, speed REAL NOT NULL CHECK(speed >= 0.5 AND speed <= 2), PRIMARY KEY(user_id,url));
