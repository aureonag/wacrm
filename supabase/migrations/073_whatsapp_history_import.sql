-- ============================================================
-- 073_whatsapp_history_import.sql - full-history import for WhatsApp
-- pessoal (groups included, resumable/background), plus disconnect
-- now deleting the imported data instead of just unlinking it.
--
-- Complementa a 072 (whatsapp_sessions). Fase inicial so trazia as
-- conversas 1:1 mais recentes; agora o usuario pode pedir o historico
-- completo (todos os chats, incluindo grupos, todas as mensagens de
-- cada um). Isso pode envolver milhares de chamadas a Evolution API,
-- entao roda em lotes (endpoint chamado repetidamente pelo cliente)
-- com progresso rastreado aqui, em vez de uma unica requisicao longa.
--
-- Idempotente - seguro rodar mais de uma vez.
-- ============================================================

-- ---- contacts.is_group -------------------------------------------
-- Um grupo do WhatsApp nao tem telefone - vira um "contato" cujo
-- phone eh o identificador numerico do grupo (unico, mas nao um
-- numero real). Esta flag deixa a UI e outras telas (ex: Vincular a
-- um pipeline) saberem que nao eh uma pessoa.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false;

-- ---- whatsapp_sessions: status geral da importacao ----------------
ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS history_import_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (history_import_status IN ('idle', 'running', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS history_import_error TEXT;

-- ---- fila de chats a importar, por usuario -------------------------
-- Uma linha por chat (1:1 ou grupo) que o findChats da Evolution API
-- retornou. "start" preenche esta tabela (pending); "process" pega um
-- lote de pending, importa, marca done/failed. O progresso real
-- (quantos done de quantos total) e sempre calculado consultando esta
-- tabela diretamente - evita dois lugares de verdade desincronizados.
CREATE TABLE IF NOT EXISTS whatsapp_history_import_chats (
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remote_jid        TEXT NOT NULL,
  is_group          BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'done', 'failed')),
  messages_imported INT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, remote_jid)
);

CREATE INDEX IF NOT EXISTS whatsapp_history_import_chats_pending_idx
  ON whatsapp_history_import_chats(user_id, status) WHERE status = 'pending';

ALTER TABLE whatsapp_history_import_chats ENABLE ROW LEVEL SECURITY;

-- Owner reads their own progress (for the progress bar). No client
-- write policy - only the API routes (service-role) write here.
DROP POLICY IF EXISTS whatsapp_history_import_chats_select_own ON whatsapp_history_import_chats;
CREATE POLICY whatsapp_history_import_chats_select_own ON whatsapp_history_import_chats FOR SELECT
  USING (auth.uid() = user_id);
