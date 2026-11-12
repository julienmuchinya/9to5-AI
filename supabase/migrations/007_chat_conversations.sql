-- 9to5 AI: chat conversations (New chat / chat history on the Chat page).
-- Messages written before this migration land in one "Earlier chats" conversation (NULL conversation_id).
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS conversation_id UUID;
CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(user_id, conversation_id, created_at);
