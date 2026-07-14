'use client';
import { PageHeader } from '@/components/ui';
import { ConfigForm, type ConfigField } from '@/components/config-form';

const FIELDS: ConfigField[] = [
  { key: 'UNSPLASH_ENABLED', label: 'Enable Unsplash images', type: 'toggle', category: 'images' },
  { key: 'UNSPLASH_ACCESS_KEY', label: 'Unsplash Access Key', type: 'password', category: 'images' },
];

export default function ImagesPage() {
  return (
    <>
      <PageHeader
        title="Images"
        description="Third-party image library (Unsplash)."
      />
      <ConfigForm fields={FIELDS} />
    </>
  );
}
