-- Keisha persistent chat sessions
-- Each session stores a full conversation thread as JSON
CREATE TABLE IF NOT EXISTS keisha_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona text NOT NULL DEFAULT 'general',
  title text,
  messages_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_keisha_sessions_persona ON keisha_chat_sessions (persona);
CREATE INDEX IF NOT EXISTS idx_keisha_sessions_updated ON keisha_chat_sessions (updated_at DESC);
