'use client';

// LinkDealDialog — "Negócios" tab on the contact detail view. Links an
// EXISTING deal to this contact (never creates one — a deal always
// starts from Pipelines). Only searches deals with no contact yet
// (contact_id IS NULL), so linking here never silently reassigns a
// deal away from whichever contact it's already attached to.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

interface UnlinkedDeal {
  id: string;
  title: string;
  value: number | null;
  currency: string | null;
}

interface LinkDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  onLinked: () => void;
}

export function LinkDealDialog({ open, onOpenChange, contactId, onLinked }: LinkDealDialogProps) {
  const t = useTranslations('Contacts.linkDeal');
  const supabase = createClient();
  const { defaultCurrency } = useAuth();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnlinkedDeal[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      let q = supabase
        .from('deals')
        .select('id, title, value, currency')
        .is('contact_id', null)
        .order('created_at', { ascending: false })
        .limit(8);
      if (query.trim()) q = q.ilike('title', `%${query.trim()}%`);
      const { data } = await q;
      setResults((data ?? []) as UnlinkedDeal[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [open, query, supabase]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleLink(deal: UnlinkedDeal) {
    setLinkingId(deal.id);
    const { error } = await supabase.from('deals').update({ contact_id: contactId }).eq('id', deal.id);
    setLinkingId(null);
    if (error) {
      toast.error(t('toastFailed'));
      return;
    }
    toast.success(t('toastLinked'));
    onLinked();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="border-border bg-muted pl-8 text-foreground"
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {searching ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{t('noResults')}</p>
          ) : (
            results.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={linkingId === d.id}
                onClick={() => handleLink(d)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left hover:bg-muted disabled:opacity-50"
              >
                <span className="truncate text-sm text-foreground">{d.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {linkingId === d.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    formatCurrency(d.value ?? 0, d.currency || defaultCurrency)
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
