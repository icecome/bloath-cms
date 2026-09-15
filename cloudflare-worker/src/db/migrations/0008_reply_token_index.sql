-- m-03: reply_token 无索引导致入站 webhook 全表扫描
CREATE INDEX IF NOT EXISTS idx_messages_reply_token ON messages(reply_token);
