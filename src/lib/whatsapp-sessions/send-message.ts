// ============================================================
// Outbound send through a PERSONAL WhatsApp session (Evolution API /
// Baileys), Fase 2 of "WhatsApp pessoal por membro do time".
//
// Mirrors src/lib/whatsapp/send-message.ts (the official Meta path)
// closely enough that the dashboard's /api/whatsapp/send route can
// pick whichever core applies to a conversation and both behave the
// same way to the caller. What's deliberately narrower here:
// templates and interactive buttons/lists are Meta Business API
// concepts that don't exist on a personal "linked device" connection,
// so those message types are rejected up front rather than faked.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { sendText, sendMedia } from '@/lib/whatsapp-sessions/evolution-client';
import { logMessageActivityForContact } from '@/lib/deals/log-message-activity';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export const PERSONAL_MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const PERSONAL_MESSAGE_TYPES = ['text', ...PERSONAL_MEDIA_KINDS] as const;

export class SendPersonalMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendPersonalMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendPersonalMessageParams {
  conversationId: string;
  whatsappSessionId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  replyToMessageId?: string | null;
}

export interface SendPersonalMessageResult {
  messageId: string;
  whatsappMessageId: string;
}

export async function sendMessageThroughPersonalSession(
  db: SupabaseClient,
  accountId: string,
  params: SendPersonalMessageParams,
): Promise<SendPersonalMessageResult> {
  const { conversationId, whatsappSessionId, messageType, contentText, mediaUrl, filename } =
    params;

  if (!(PERSONAL_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendPersonalMessageError(
      'unsupported_type',
      `"${messageType}" não é suportado no WhatsApp pessoal (só texto e mídia — templates e mensagens interativas são exclusivos da API oficial da Meta)`,
      400,
    );
  }

  const isMediaKind = (PERSONAL_MEDIA_KINDS as readonly string[]).includes(messageType);
  if (messageType === 'text' && !contentText) {
    throw new SendPersonalMessageError('bad_request', 'content_text is required', 400);
  }
  if (isMediaKind && !mediaUrl) {
    throw new SendPersonalMessageError('bad_request', 'media_url is required', 400);
  }

  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendPersonalMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendPersonalMessageError('bad_request', 'Contact phone number not found', 400);
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendPersonalMessageError('bad_request', 'Invalid phone number format', 400);
  }

  // The row's instance_name, not the account's — this send must go out
  // through the specific person's device, never a different teammate's.
  const { data: session, error: sessionError } = await supabaseAdmin()
    .from('whatsapp_sessions')
    .select('instance_name, status')
    .eq('user_id', whatsappSessionId)
    .maybeSingle();

  if (sessionError || !session) {
    throw new SendPersonalMessageError('session_not_found', 'WhatsApp session not found', 404);
  }
  if (session.status !== 'connected') {
    throw new SendPersonalMessageError(
      'session_disconnected',
      'Esse WhatsApp pessoal está desconectado — reconecte em Configurações antes de responder.',
      409,
    );
  }

  let waMessageId: string;
  try {
    if (messageType === 'text') {
      const result = await sendText(session.instance_name, sanitizedPhone, contentText!);
      waMessageId = result.messageId;
    } else {
      const result = await sendMedia(session.instance_name, sanitizedPhone, {
        mediaType: messageType as (typeof PERSONAL_MEDIA_KINDS)[number],
        url: mediaUrl!,
        caption: contentText || undefined,
        fileName: filename || undefined,
      });
      waMessageId = result.messageId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Evolution API error';
    throw new SendPersonalMessageError('evolution_error', `Evolution API error: ${message}`, 502);
  }

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: contentText ?? null,
      media_url: mediaUrl || null,
      message_id: waMessageId || crypto.randomUUID(),
      status: 'sent',
      reply_to_message_id: params.replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[whatsapp-sessions/send] error inserting sent message:', msgError);
    throw new SendPersonalMessageError(
      'db_error',
      `Message sent but failed to save to DB: ${msgError.message}`,
      500,
    );
  }

  await logMessageActivityForContact(db, accountId, contact.id);

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
