import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Edit, Eye, AlertTriangle } from 'lucide-react';
import { BnScreenRoleBanner } from '@/components/bn/shared';
import { useBnProducts } from '@/hooks/bn/useBnProduct';
import { useBnCountries } from '@/hooks/bn/useBnConfig';

import { BN_PRODUCT_STATUS_LABELS } from '@/types/bn';
import type { BnProduct, BnProductStatus } from '@/types/bn';
import { BNDataGrid, type BNColumnDef } from '@/components/bn/grid';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import PaymentHierarchyHealth from '@/components/bn/product/PaymentHierarchyHealth';

const statusVariant: Record<BnProductStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'outline',
  ACTIVE: 'default',
  SUSPENDED: 'destructive',
  ARCHIVED: 'outline',
};

export default function ProductCatalog() {
  const navigate = useNavigate();
  const { data: products = [], isLoading, refetch } = useBnProducts();
  const { data: countries = [] } = useBnCountries();
  const validCodes = useMemo(() => new Set((countries as any[]).map(c => c.country_code)), [countries]);

  // Default the catalog filter to SKN (St. Kitts and Nevis); 'ALL' shows everything.
  const [filterCode, setFilterCode] = useState<string>('SKN');

  const filteredProducts = useMemo(() => {
    if (filterCode === 'ALL') return products;
    return (products as BnProduct[]).filter(p => p.country_code === filterCode);
  }, [products, filterCode]);

  /**
   * The live version of each product, if it has one.
   *
   * bn_product.status was never written when a version went live, so a product
   * running on an ACTIVE version still read DRAFT here — the catalogue said a
   * benefit was a draft while it was in service. Publishing now promotes the
   * product, but products published before that fix still hold the stale value,
   * so the displayed status is derived from the versions rather than trusted
   * from the product row.
   */
  const { data: liveVersions = new Map<string, number>() } = useQuery({
    queryKey: ['bn-product-live-versions'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bn_product_version')
        .select('product_id, version_number, status')
        .eq('status', 'ACTIVE');
      if (error) throw error;
      const map = new Map<string, number>();
      for (const v of (data ?? []) as any[]) {
        // Keep the highest version number where a product has more than one
        // ACTIVE version — itself a data fault, but not one to hide here.
        const prev = map.get(v.product_id);
        if (prev === undefined || v.version_number > prev) map.set(v.product_id, v.version_number);
      }
      return map;
    },
  });

  /** ACTIVE if the product has a live version; otherwise the product's own status. */
  const effectiveStatus = (p: BnProduct): BnProductStatus =>
    liveVersions.has(p.id) ? 'ACTIVE' : (p.status as BnProductStatus);

  const orphanCount = useMemo(
    () => (products as BnProduct[]).filter(p => !p.country_code || !validCodes.has(p.country_code)).length,
    [products, validCodes]
  );

  const columns: BNColumnDef<BnProduct>[] = [
    { accessorKey: 'benefit_code', header: 'Code', meta: { label: 'Code', pinLeft: true, width: 140 }, cell: ({ getValue }) => <span className="font-mono">{String(getValue() ?? '')}</span> },
    { accessorKey: 'benefit_name', header: 'Name', meta: { label: 'Name', width: 280 }, cell: ({ getValue }) => <span className="font-medium">{String(getValue() ?? '')}</span> },
    { accessorKey: 'category', header: 'Category', meta: { label: 'Category', width: 140 } },
    { accessorKey: 'branch', header: 'Branch', meta: { label: 'Branch', width: 140 }, cell: ({ row }) => <span>{(row.original as any).bn_branch?.branch_name ?? row.original.branch}</span> },
    { accessorKey: 'payment_type', header: 'Payment', meta: { label: 'Payment', width: 120 } },
    {
      accessorKey: 'country_code',
      header: 'Country',
      meta: { label: 'Country', width: 110 },
      cell: ({ getValue }) => {
        const code = String(getValue() ?? '');
        const orphan = !code || !validCodes.has(code);
        return orphan
          ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{code || 'NONE'}</Badge>
          : <span>{code}</span>;
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      meta: { label: 'Status', width: 170 },
      cell: ({ row }) => {
        const p = row.original;
        const s = effectiveStatus(p);
        const liveVersion = liveVersions.get(p.id);
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={statusVariant[s] || 'outline'}>{BN_PRODUCT_STATUS_LABELS[s] || s}</Badge>
            {/* Which version is live, so "Active" is not just an assertion. */}
            {liveVersion !== undefined && (
              <span className="text-xs text-muted-foreground">v{liveVersion}</span>
            )}
          </div>
        );
      },
    },
  ];

  const summary = [
    { label: 'Total', value: filteredProducts.length, tone: 'default' as const },
    // Counted on the same derived status as the column, so the tiles and the
    // rows cannot disagree.
    { label: 'Active', value: filteredProducts.filter(p => effectiveStatus(p) === 'ACTIVE').length, tone: 'success' as const },
    { label: 'Draft', value: filteredProducts.filter(p => effectiveStatus(p) === 'DRAFT').length, tone: 'warning' as const },
    { label: 'Pending', value: filteredProducts.filter(p => effectiveStatus(p) === 'PENDING_APPROVAL').length, tone: 'info' as const },
    { label: 'Suspended', value: filteredProducts.filter(p => effectiveStatus(p) === 'SUSPENDED').length, tone: 'danger' as const },
    { label: 'Archived', value: filteredProducts.filter(p => effectiveStatus(p) === 'ARCHIVED').length, tone: 'muted' as const },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="t-page-title">Benefit Product Catalog</h1>
        <p className="t-page-subtitle mt-1">
          Configure all rules and requirements for each benefit product — eligibility, calculation, documents, workflow, screens, timelines, interactions, and overrides.
        </p>
      </div>

      <BnScreenRoleBanner
        role="product-assembly"
        description="This is the central Product Assembly workbench. For each product version, configure eligibility, calculation formulas, required documents, service documents, medical policy, workflow, transition fallback, screen/field template, workbasket routing, escalation policy, reason code usage and communications. All reusable building blocks are selected from the libraries — they are not redefined here."
      />

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-muted/30 p-3">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Country Pack</Label>
            <Select value={filterCode} onValueChange={setFilterCode}>
              <SelectTrigger className="w-[260px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Countries</SelectItem>
                {(countries as any[]).filter(c => c.is_active).map((c: any) => (
                  <SelectItem key={c.country_code} value={c.country_code}>
                    {c.country_name} ({c.country_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {orphanCount > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {orphanCount} product(s) with invalid country_code
          </Badge>
        )}
      </div>

      <PaymentHierarchyHealth countryCode={filterCode} />

      <BNDataGrid
        id="bn.product-catalog"
        columns={columns}
        data={filteredProducts}
        isLoading={isLoading}
        searchPlaceholder="Search by code, name, category…"
        summary={summary}
        defaultSort={[{ id: 'benefit_code', desc: false }]}
        onCreate={() => navigate('/bn/config/products/new')}
        onRefresh={() => refetch()}
        onRowClick={(p) => navigate(`/bn/config/products/${p.id}`)}
        rowActions={[
          { key: 'view', label: 'View', icon: <Eye className="h-3.5 w-3.5" />, onClick: (p) => navigate(`/bn/config/products/${p.id}`) },
          { key: 'edit', label: 'Edit', icon: <Edit className="h-3.5 w-3.5" />, onClick: (p) => navigate(`/bn/config/products/${p.id}`) },
        ]}
        exportFilename="bn_product_catalog"
        emptyMessage="No benefit products configured yet. Click Create New to get started."
      />
    </div>
  );
}
