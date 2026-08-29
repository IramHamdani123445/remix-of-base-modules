import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Loader2, Download } from 'lucide-react';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { exportReportToExcel, ReportColumn } from '@/utils/reportExcelExport';
import {
  fetchViolationReportFilterOptions,
  fetchViolationReportGroups,
  ViolationReportDimension,
  ViolationReportGroupRow,
} from '@/services/violationReportsService';

interface Props {
  title: string;
  subtitle: string;
  breadcrumbLabel: string;
  /** Grouping dimension resolved server-side. */
  dimension: ViolationReportDimension;
  filters: Array<'dateRange' | 'status' | 'type' | 'fund' | 'zone' | 'severity'>;
  /** Render the report body once aggregated rows are known. */
  renderBody: (rows: ViolationReportGroupRow[]) => React.ReactNode;
  exportFilename?: string;
  exportColumns?: ReportColumn[];
  mapExportRow?: (r: ViolationReportGroupRow) => Record<string, any>;
}

export default function ViolationReportShell({
  title,
  subtitle,
  breadcrumbLabel,
  dimension,
  filters,
  renderBody,
  exportFilename,
  exportColumns,
  mapExportRow,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  const { data: options } = useQuery({
    queryKey: ['violation_report_filter_options'],
    queryFn: fetchViolationReportFilterOptions,
    staleTime: 5 * 60_000,
  });

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['violation_report_groups', dimension, values],
    queryFn: () =>
      fetchViolationReportGroups(dimension, {
        from: values.from,
        to: values.to,
        status: values.status,
        type: values.type,
        fund: values.fund,
        zone: values.zone,
        severity: values.severity,
      }),
    staleTime: 60_000,
  });

  const toOptions = (list: string[] | undefined, label?: (v: string) => string) => [
    { value: 'all', label: 'All' },
    ...(list || []).map(v => ({ value: v, label: label ? label(v) : v })),
  ];

  const fields: FilterField[] = useMemo(() => {
    const f: FilterField[] = [];
    if (filters.includes('dateRange')) {
      f.push({ key: 'from', label: 'From', type: 'date' });
      f.push({ key: 'to', label: 'To', type: 'date' });
    }
    if (filters.includes('status')) {
      f.push({ key: 'status', label: 'Status', type: 'select', options: toOptions(options?.statuses, v => v.replace(/_/g, ' ')) });
    }
    if (filters.includes('type')) {
      f.push({ key: 'type', label: 'Violation Type', type: 'select', options: toOptions(options?.types) });
    }
    if (filters.includes('fund')) {
      f.push({ key: 'fund', label: 'Fund', type: 'select', options: toOptions(options?.funds) });
    }
    if (filters.includes('zone')) {
      f.push({ key: 'zone', label: 'Zone / Office', type: 'select', options: toOptions(options?.zones) });
    }
    if (filters.includes('severity')) {
      f.push({ key: 'severity', label: 'Severity', type: 'select', options: toOptions(options?.severities) });
    }
    return f;
  }, [filters, options]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Reports', href: '/compliance/reports' },
          { label: 'Violation Reports', href: '/compliance/reports/violations' },
          { label: breadcrumbLabel },
        ]}
      />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent>
          <FilterBar
            filters={fields}
            values={values}
            onChange={(k, v) => setValues(prev => ({ ...prev, [k]: v }))}
            onReset={() => setValues({})}
          />
        </CardContent>
      </Card>

      {exportColumns && exportFilename && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={async () => {
              const data = rows.map(mapExportRow ? mapExportRow : (r) => r as any);
              await exportReportToExcel(data, exportColumns, exportFilename, breadcrumbLabel);
            }}
          >
            <Download className="h-4 w-4 mr-2" />Export
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <EmptyState title="Unable to load violations" description="Please retry shortly or contact support." />
      ) : rows.length === 0 ? (
        <EmptyState
          title={`No violations match this ${breadcrumbLabel.toLowerCase()} report`}
          description="Try adjusting the filters above to broaden the results."
        />
      ) : (
        renderBody(rows)
      )}
    </div>
  );
}
