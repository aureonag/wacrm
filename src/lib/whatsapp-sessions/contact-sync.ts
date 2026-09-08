// ============================================================
// Shared contact/conversation find-or-create + message classification
// for the personal-WhatsApp (Evolution API) paths — used by both the
// live inbound webhook and the history-import route, so a message
// looks the same in the Inbox regardless of which path put it there.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

// Baileys' remoteJid is "<digits>@s.whatsapp.net" for a 1:1 chat, or
// "<digits>@g.us" for a group. Live inbound (the webhook) only handles
// 1:1 — mirrors how the official Meta webhook has no group concept
// either. History import handles both (see identityFromJid below).
export function phoneFromJid(jid: string | undefined | null): string | null {
  if (!jid) return null;
  if (jid.endsWith('@g.us')) return null;
  const [digits] = jid.split('@');
  return normalizePhone(digits ?? '');
}

/**
 * Resolve a chat's identity for history import, which — unlike the
 * live webhook — also imports groups. A group has no phone number, so
 * its numeric id (unique, stable) is stored in `contacts.phone` as an
 * arbitrary-but-unique key; `contacts.is_group` is what tells the UI
 * (and anything that shouldn't treat a group as a person, like
 * "Vincular a um pipeline") which kind of row it is. Returns null for
 * jids this app doesn't have an identity model for yet (e.g. `@lid`
 * addressing — a WhatsApp identity system without a stable phone
 * number Evolution API exposes).
 */
export function identityFromJid(
  jid: string | undefined | null,
): { id: string; isGroup: boolean } | null {
  if (!jid) return null;
  if (jid.endsWith('@g.us')) {
    const [id] = jid.split('@');
    return id ? { id, isGroup: true } : null;
  }
  if (jid.endsWith('@s.whatsapp.net')) {
    const phone = phoneFromJid(jid);
    return phone ? { id: phone, isGroup: false } : null;
  }
  return null;
}

/**
 * Classify one Baileys message record into our `messages.content_type` /
 * `content_text`. Media messages (image/video/document/audio/sticker)
 * are never mirrored here — Baileys media URLs point at Meta's
 * encrypted CDN and need Baileys' own key material to decrypt, which is
 * out of scope. They're stored as a plain `text` row with a bracketed
 * placeholder (matching how the live webhook already falls back for
 * message types it doesn't render) so the thread stays readable
 * instead of showing a broken image.
 */
export function classifyMessage(
  messageType: string | undefined,
  message: Record<string, unknown> | undefined,
): { contentText: string } {
  const get = (key: string) => message?.[key] as Record<string, unknown> | undefined;

  switch (messageType) {
    case 'conversation':
      return { contentText: (message?.conversation as string) || '' };
    case 'extendedTextMessage':
      return { contentText: (get('extendedTextMessage')?.text as string) || '' };
    case 'imageMessage': {
      const caption = get('imageMessage')?.caption as string | undefined;
      return { contentText: caption ? `[Imagem] ${caption}` : '[Imagem]' };
    }
    case 'videoMessage': {
      const caption = get('videoMessage')?.caption as string | undefined;
      return { contentText: caption ? `[Vídeo] ${caption}` : '[Vídeo]' };
    }
    case 'documentMessage': {
      const doc = get('documentMessage');
      const name = (doc?.fileName as string) || (doc?.caption as string) || '';
      return { contentText: name ? `[Documento] ${name}` : '[Documento]' };
    }
    case 'audioMessage':
      return { contentText: '[Áudio]' };
    case 'stickerMessage':
      return { contentText: '[Figurinha]' };
    case 'reactionMessage':
      return { contentText: (get('reactionMessage')?.text as string) || '[Reação]' };
    // Real WhatsApp protocol message kinds this thread doesn't render
    // (channel/community comment, business template send, interactive
    // message, history-sync placeholder) — named explicitly so the
    // default case below never has to leak Baileys' raw camelCase type
    // name to the end user.
    case 'commentMessage':
      return { contentText: '[Comentário]' };
    case 'templateMessage':
      return { contentText: '[Modelo]' };
    case 'interactiveMessage':
      return { contentText: '[Mensagem interativa]' };
    case 'placeholderMessage':
      return { contentText: '[Mensagem indisponível]' };
    default:
      return { contentText: '[Mensagem não suportada]' };
  }
}

export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
  // Lazy — only called when a contact row is actually about to be
  // inserted, so an existing contact never pays for an avatar lookup.
  fetchAvatarUrl?: () => Promise<string | null>,
  isGroup = false,
) {
  const existing = await findExistingContact(db, accountId, phone);
  if (existing) return existing;

  const avatarUrl = fetchAvatarUrl ? await fetchAvatarUrl() : null;

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: name || phone,
      avatar_url: avatarUrl || null,
      is_group: isGroup,
    })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return findExistingContact(db, accountId, phone);
    }
    console.error('[whatsapp-sessions] contact create failed:', error);
    return null;
  }
  return created;
}

export async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
  whatsappSessionId: string,
) {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findError) {
    console.error('[whatsapp-sessions] conversation lookup failed:', findError);
    return null;
  }
  if (existingRows && existingRows.length > 0) {
    const existing = existingRows[0];
    // Re-link on every message, not just at creation. A conversation
    // can lose its tag (disconnect nulls it — migration 072's FK is ON
    // DELETE SET NULL) and then get a new inbound message after the
    // person reconnects; without this, it stays permanently untagged
    // and a future disconnect's cleanup can never find it again.
    if (existing.whatsapp_session_id !== whatsappSessionId) {
      const { data: relinked } = await db
        .from('conversations')
        .update({ whatsapp_session_id: whatsappSessionId })
        .eq('id', existing.id)
        .select()
        .single();
      return relinked ?? existing;
    }
    return existing;
  }

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      whatsapp_session_id: whatsappSessionId,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) return raced[0];
    }
    console.error('[whatsapp-sessions] conversation create failed:', createError);
    return null;
  }
  return created;
}
