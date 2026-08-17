/**
 * Omni-Comms — Stationery.
 *
 * Surfaces the existing Communication Hub stationery editors inside
 * Omni-Comms, where printed correspondence is actually produced.
 *
 * IMPORTANT: this is a second entry point, not a second system. The very
 * same page components, hooks and tables (`comm_letterhead`,
 * `comm_media_asset`, `core_text_block`, headers/footers, signatures) are
 * rendered here — no duplicate records, no parallel editors.
 */
import React, { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';

const LetterheadsPage = lazy(() => import('@/pages/admin/organization/LetterheadsPage'));
const MediaLibraryPage = lazy(() => import('@/pages/admin/organization/MediaLibraryPage'));
const TextBlocksPage = lazy(() => import('@/pages/admin/organization/TextBlocksPage'));
const HeadersFootersPage = lazy(() => import('@/pages/admin/organization/HeadersFootersPage'));
const SignaturesPage = lazy(() => import('@/pages/admin/organization/SignaturesPage'));

const SECTIONS = [
  { id: 'letterheads', label: 'Letterheads', Component: LetterheadsPage },
  { id: 'media', label: 'Media library', Component: MediaLibraryPage },
  { id: 'text-blocks', label: 'Text blocks', Component: TextBlocksPage },
  { id: 'headers-footers', label: 'Headers & footers', Component: HeadersFootersPage },
  { id: 'signatures', label: 'Signatures', Component: SignaturesPage },
] as const;

export type StationerySection = (typeof SECTIONS)[number]['id'];

export function resolveStationerySection(raw: string | null | undefined): StationerySection {
  const v = (raw ?? '').trim().toLowerCase();
  return (SECTIONS.some((s) => s.id === v) ? v : 'letterheads') as StationerySection;
}

export const StationerySurface: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = resolveStationerySection(searchParams.get('section'));

  const select = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', 'stationery');
    params.set('section', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="space-y-4" data-testid="omni-comms-stationery">
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold">Stationery</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Letterheads, media assets, text blocks, headers and footers and
            signatures used by printed correspondence. These are the same
            records the Communication Hub edits — changed once, applied
            everywhere.
          </p>
        </CardContent>
      </Card>

      <Tabs value={section} onValueChange={select} className="w-full">
        <TabsList className="flex flex-wrap">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.id} value={s.id} data-testid={`omni-comms-stationery-${s.id}`}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {SECTIONS.map(({ id, Component }) => (
          <TabsContent key={id} value={id} className="mt-4">
            {section === id ? (
              <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
                <Component />
              </Suspense>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default StationerySurface;
