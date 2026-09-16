'use client';

// LinkContactDialog — "Contato principal" card on the deal detail page,
// empty state. Search an existing contact to link, or hand off to the
// existing ContactForm to create a brand new one (its onSaved now
// reports the new contact's id back, see contact-form.tsx).

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ContactForm } from '@/components/contacts/contact-form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Contact } from '@/types';

interface LinkContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: (contact: Contact) => void;
}

export function LinkContactDialog({ open, onOpenChange, onLinked }: LinkContactDialogProps) {
  const t = useTranslations('Pipelines.linkContact');
  const supabase = createClient();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      return;
    }
    const like = `%${query.trim()}%`;
    setSearching(true);
    const handle = setTimeout(async () => {
      let q = supabase.from('contacts').select('*').order('created_at', { ascending: false }).limit(8);
      if (query.trim()) {
        q = q.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
      }
      const { data } = await q;
      setResults((data ?? []) as Contact[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [open, query, supabase]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <>
      <Dialog open={open && !createOpen} onOpenChange={onOpenChange}>
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
              results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onLinked(c);
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">{c.name || c.phone}</span>
                    {c.name && <span className="block truncate text-xs text-muted-foreground">{c.phone}</span>}
                  </span>
                </button>
              ))
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => setCreateOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-4" />
            {t('createNew')}
          </Button>
        </DialogContent>
      </Dialog>

      <ContactForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={async (contactId) => {
          const { data } = await supabase.from('contacts').select('*').eq('id', contactId).single();
          if (data) onLinked(data as Contact);
          setCreateOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
