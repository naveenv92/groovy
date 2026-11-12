ALTER TABLE users ADD COLUMN library_view TEXT NOT NULL DEFAULT 'tiles' CHECK (library_view IN ('tiles','list'));
