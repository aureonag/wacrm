'use client';

// ============================================================
// InviteMemberDialog
//
// Two modes, picked via a tab at the top of the form step:
//
//   'link'   — the original flow. Role + expiry + optional label
//              → POST creates a shareable one-time invite link.
//              The invitee self-registers (or logs in) and redeems
//              it themselves; no password ever passes through us.
//
//   'direct' — "Criar acesso agora". Full name + email + password
//              + role → POST creates the auth user immediately
//              (server-side, service-role, email pre-confirmed) and
//              assigns them into the account. No self-signup round
//              trip — the admin hands the credentials to the new
//              teammate directly.
//
// Both modes end on the same kind of result step: a one-time
// reveal (link, or email+password) that disappears once the modal
// closes, with copy buttons and a WhatsApp share shortcut.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Dices, Loader2, MessageCircle, Sparkles } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { generatePassword } from '@/lib/auth/generate-password';

type InviteRole = 'admin' | 'agent' | 'viewer';
type Mode = 'link' | 'direct';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the
   *  roster / pending-invitations list. */
  onCreated: () => void;
}

const EXPIRY_OPTIONS = [
  { value: '1', labelKey: 'days1' },
  { value: '7', labelKey: 'days7' },
  { value: '30', labelKey: 'days30' },
];

// Server caps label at 80 chars (see src/app/api/account/invitations/route.ts).
// Mirror it on the client so we short-circuit before the round-trip
// rather than letting the user submit and bounce off a 400.
const MAX_LABEL_LEN = 80;
const MIN_PASSWORD_LEN = 6;

interface LinkResult {
  kind: 'link';
  url: string;
  role: InviteRole;
  expiresInDays: number;
  accountName: string;
}

interface DirectResult {
  kind: 'direct';
  email: string;
  password: string;
  role: InviteRole;
  accountName: string;
}

type CreatedResult = LinkResult | DirectResult;

export function InviteMemberDialog({
  open,
  onOpenChange,
  onCreated,
}: InviteMemberDialogProps) {
  const t = useTranslations('Settings.invite');
  const tRoles = useTranslations('Settings.roles');
  const { account } = useAuth();

  const [mode, setMode] = useState<Mode>('link');

  // Link-mode fields
  const [role, setRole] = useState<InviteRole>('agent');
  const [expiry, setExpiry] = useState<string>('7');
  const [label, setLabel] = useState('');

  // Direct-mode fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedResult | null>(null);

  function reset() {
    setMode('link');
    setRole('agent');
    setExpiry('7');
    setLabel('');
    setFullName('');
    setEmail('');
    setPassword('');
    setResult(null);
    setSubmitting(false);
  }

  async function handleCreateLink() {
    // Mirror the server's max-length check so we don't ship an
    // obviously-too-long label across the wire just to bounce off
    // a 400. The Input also has a `maxLength={MAX_LABEL_LEN}` cap
    // but a paste can land an over-limit string into state before
    // the limit kicks in on the next keystroke — this is the safety
    // net for that path.
    const trimmedLabel = label.trim();
    if (trimmedLabel.length > MAX_LABEL_LEN) {
      toast.error(t('labelTooLong', { max: MAX_LABEL_LEN }));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          expiresInDays: Number(expiry),
          label: trimmedLabel || undefined,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to create invitation');
        return;
      }

      const data = (await res.json()) as {
        url: string;
        expiresInDays: number;
      };

      setResult({
        kind: 'link',
        url: data.url,
        role,
        expiresInDays: data.expiresInDays,
        // Snapshot the account name into the result so the wa.me
        // share message has team context. Falls back to a generic
        // string if `account` hasn't loaded yet (shouldn't happen
        // — the dialog requires admin+ which requires a loaded
        // profile — but stay safe).
        accountName: account?.name ?? 'our wacrm account',
      });
      onCreated();
    } catch (err) {
      console.error('[InviteMemberDialog] create error:', err);
      toast.error('Could not reach the server. Try again?');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateDirect() {
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      toast.error(t('directRequiredFields'));
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      toast.error(t('directPasswordTooShort', { min: MIN_PASSWORD_LEN }));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/account/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: trimmedName,
          email: trimmedEmail,
          password,
          role,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('directCreateFailed'));
        return;
      }

      setResult({
        kind: 'direct',
        email: trimmedEmail,
        password,
        role,
        accountName: account?.name ?? 'our wacrm account',
      });
      onCreated();
    } catch (err) {
      console.error('[InviteMemberDialog] direct create error:', err);
      toast.error('Could not reach the server. Try again?');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      // Most likely "not in a secure context" — happens on http://
      // local IPs. The value stays visible in the field so the
      // admin can hand-select it.
      toast.error(t('clipboardBlocked'));
    }
  }

  function whatsappShareUrl(): string {
    if (!result) return '#';
    const accountName = result.accountName;
    if (result.kind === 'link') {
      const message = t('whatsappMessage', {
        accountName,
        expiresInDays: result.expiresInDays,
        url: result.url,
      });
      return `https://wa.me/?text=${encodeURIComponent(message)}`;
    }
    const message = t('whatsappMessageDirect', {
      accountName,
      email: result.email,
      password: result.password,
    });
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reset state when the dialog closes — both for cancel and
        // for dismissal after a successful create. Neither the
        // plaintext link nor the plaintext password is preserved
        // across opens.
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <Sparkles className="size-4 text-primary" />
                {result.kind === 'link' ? t('inviteCreated') : t('accountCreated')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {result.kind === 'link' ? (
                  t.rich('inviteCreatedDesc', {
                    role: tRoles(result.role),
                    days: result.expiresInDays,
                    bold: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
                  })
                ) : (
                  t.rich('accountCreatedDesc', {
                    role: tRoles(result.role),
                    bold: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
                  })
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {result.kind === 'link' ? (
                <>
                  <Label className="text-muted-foreground">{t('inviteLink')}</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={result.url}
                      className="bg-muted border-border text-foreground font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      onClick={() => copyToClipboard(result.url, t('copied'))}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                    >
                      <Copy className="size-4" />
                      {t('copy')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground">{t('emailLabel')}</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={result.email}
                        className="bg-muted border-border text-foreground font-mono text-xs"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button
                        type="button"
                        onClick={() => copyToClipboard(result.email, t('copied'))}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground">{t('passwordLabel')}</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={result.password}
                        className="bg-muted border-border text-foreground font-mono text-xs"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button
                        type="button"
                        onClick={() => copyToClipboard(result.password, t('copied'))}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {/* Higher-contrast amber than the original 10% / amber-200.
                  Reviewed against slate-900 to meet WCAG AAA for body
                  text (target ratio 7:1). Border bumped to /50, bg to
                  /15, foreground promoted to amber-100 for the strong
                  intro, amber-200 for the body. */}
              <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                <strong className="font-semibold text-amber-100">
                  {t('saveLinkNow')}
                </strong>{' '}
                {result.kind === 'link' ? t('saveLinkHint') : t('savePasswordHint')}
              </div>

              {/* Anchor styled with `buttonVariants` rather than wrapping
                  in <Button asChild>. The wacrm Button is the Base UI
                  ButtonPrimitive — it has no Radix-style asChild slot.
                  Direct anchor preserves right-click "Open in new tab"
                  behaviour too. */}
              <a
                href={whatsappShareUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonVariants({
                  variant: 'outline',
                  className:
                    'w-full border-border text-muted-foreground hover:bg-muted',
                })}
              >
                <MessageCircle className="size-4" />
                {t('sendViaWhatsApp')}
              </a>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                onClick={() => onOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {t('done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t('dialogTitle')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {mode === 'link' ? t('dialogDesc') : t('dialogDescDirect')}
              </DialogDescription>
            </DialogHeader>

            <Tabs value={mode} onValueChange={(v) => v && setMode(v as Mode)}>
              <TabsList className="w-full">
                <TabsTrigger value="link" className="flex-1">
                  {t('modeLink')}
                </TabsTrigger>
                <TabsTrigger value="direct" className="flex-1">
                  {t('modeDirect')}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-4 py-2">
              {mode === 'direct' && (
                <>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">{t('fullNameLabel')}</Label>
                    <Input
                      placeholder={t('fullNamePlaceholder')}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">{t('emailLabel')}</Label>
                    <Input
                      type="email"
                      placeholder={t('emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">{t('passwordLabel')}</Label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        placeholder={t('passwordPlaceholder')}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setPassword(generatePassword())}
                        className="border-border text-muted-foreground hover:bg-muted shrink-0"
                        title={t('generatePassword')}
                      >
                        <Dices className="size-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('directPasswordHint')}
                    </p>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('roleLabel')}</Label>
                <Select
                  value={role}
                  onValueChange={(v) => v && setRole(v as InviteRole)}
                >
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue>{tRoles(role)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                    <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                    <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {tRoles(`${role}Hint` as 'adminHint' | 'agentHint' | 'viewerHint')}
                </p>
              </div>

              {mode === 'link' && (
                <>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">{t('validForLabel')}</Label>
                    <Select
                      value={expiry}
                      onValueChange={(v) => v && setExpiry(v)}
                    >
                      <SelectTrigger className="w-full bg-muted border-border text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey as Parameters<typeof t>[0])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('labelTitle')}{' '}
                      <span className="text-xs text-muted-foreground">{t('optional')}</span>
                    </Label>
                    <Input
                      placeholder={t('labelPlaceholder')}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      maxLength={MAX_LABEL_LEN}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('labelHint')}
                    </p>
                  </div>
                </>
              )}
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={mode === 'link' ? handleCreateLink : handleCreateDirect}
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('creating')}
                  </>
                ) : mode === 'link' ? (
                  t('generateLink')
                ) : (
                  t('createAccess')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
