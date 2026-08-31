'use client';

import { Shield, SlidersHorizontal } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { CustomFieldsPanel } from '@/components/contacts/custom-fields-manager';
import type { CustomFieldEntityType } from '@/types';
import { SettingsChip } from './settings-chip';

/**
 * Settings → Custom Fields card. Manages the account-wide custom field
 * catalogue for one entity type — contacts (the same panel the Contacts
 * page exposes via a dialog) or deals. Writes are admin-gated by the
 * caller and enforced by `custom_fields` RLS.
 */
export function CustomFieldsSettings({ entityType }: { entityType: CustomFieldEntityType }) {
  const t = useTranslations('Settings.tagsAndFields');
  const titleKey = entityType === 'deal' ? 'dealFieldsTitle' : 'fieldsTitle';
  const descKey = entityType === 'deal' ? 'dealFieldsDesc' : 'fieldsDesc';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <SlidersHorizontal className="size-4 text-primary" />
          {t(titleKey)}
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            {t('adminRole')}
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t(descKey)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CustomFieldsPanel entityType={entityType} />
      </CardContent>
    </Card>
  );
}
