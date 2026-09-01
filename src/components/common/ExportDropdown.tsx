import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import { Download, FileSpreadsheet, FileText, FileDown, Printer, FileType } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { generateSSBReport } from '@/lib/reportTemplate';
import {
  exportPDFWithMetadata,
  exportDocx,
  exportGroupedPDF,
  exportGroupedExcel,
  type ExportMetadata,
  type GroupByOption,
} from '@/lib/auditReportExports';

export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
}

interface ExportDropdownProps {
  data: any[];
  columns: ExportColumn[];
  fileName: string;
  title?: string;
  metadata?: ExportMetadata;
  groupByOptions?: GroupByOption[];
  onPrint?: () => void;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const ExportDropdown: React.FC<ExportDropdownProps> = ({
  data,
  columns,
  fileName,
  title,
  metadata,
  groupByOptions,
  onPrint,
  variant = 'outline',
  size = 'sm',
}) => {
  const { toast } = useToast();

  const exportExcel = async () => {
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Data');
      ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF009B4C' } };
      data.forEach(row => {
        const mapped: Record<string, any> = {};
        columns.forEach(c => { mapped[c.key] = row[c.key] ?? ''; });
        ws.addRow(mapped);
      });
      ws.eachRow(row => {
        row.eachCell(cell => {
          cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        });
      });
      const buffer = await wb.xlsx.writeBuffer();
      saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileName}.xlsx`);
      toast({ title: 'Export Successful', description: `Exported ${data.length} records to Excel` });
    } catch {
      toast({ title: 'Export Failed', description: 'Failed to export to Excel', variant: 'destructive' });
    }
  };

  const exportCSV = () => {
    try {
      const escape = (v: any) => {
        if (v === null || v === undefined) return '';
        // Collapse embedded newlines so one record always occupies one CSV line,
        // keeping the exported row count identical to the on-screen row count.
        const s = String(v).replace(/\r?\n/g, ' ').trim();
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        columns.map(c => escape(c.header)).join(','),
        ...data.map(row => columns.map(c => escape(row[c.key])).join(',')),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      saveAs(blob, `${fileName}.csv`);
      toast({ title: 'Export Successful', description: `Exported ${data.length} records to CSV` });
    } catch {
      toast({ title: 'Export Failed', description: 'Failed to export to CSV', variant: 'destructive' });
    }
  };

  const exportPDF = () => {
    try {
      if (metadata) {
        exportPDFWithMetadata(
          columns.map(c => ({ header: c.header, key: c.key })),
          data,
          metadata,
          fileName,
        );
      } else {
        generateSSBReport(
          {
            title: title || fileName,
            subtitle: `Total Records: ${data.length}`,
            additionalInfo: [{ label: 'Generated', value: new Date().toLocaleDateString() }],
          },
          columns.map(c => ({ header: c.header, key: c.key })),
          data,
          fileName,
        );
      }
      toast({ title: 'Export Successful', description: `Exported ${data.length} records to PDF` });
    } catch {
      toast({ title: 'Export Failed', description: 'Failed to export to PDF', variant: 'destructive' });
    }
  };

  const handleExportDocx = async () => {
    try {
      const meta = metadata || {
        title: title || fileName,
        generatedDate: new Date().toLocaleDateString(),
        totalRecords: data.length,
        filtersApplied: [],
      };
      await exportDocx(columns, data, meta, fileName);
      toast({ title: 'Export Successful', description: `Exported ${data.length} records to DOCX` });
    } catch {
      toast({ title: 'Export Failed', description: 'Failed to export to DOCX', variant: 'destructive' });
    }
  };

  const handleGroupedPDF = (opt: GroupByOption) => {
    try {
      const meta = metadata || {
        title: title || fileName,
        generatedDate: new Date().toLocaleDateString(),
        totalRecords: data.length,
        filtersApplied: [],
      };
      exportGroupedPDF(
        columns.map(c => ({ header: c.header, key: c.key })),
        data,
        opt.key,
        opt.label,
        meta,
        `${fileName}-by-${opt.key}`,
      );
      toast({ title: 'Export Successful', description: `Exported grouped report by ${opt.label}` });
    } catch {
      toast({ title: 'Export Failed', description: 'Failed to generate grouped report', variant: 'destructive' });
    }
  };

  const handleGroupedExcel = async (opt: GroupByOption) => {
    try {
      const meta = metadata || {
        title: title || fileName,
        generatedDate: new Date().toLocaleDateString(),
        totalRecords: data.length,
        filtersApplied: [],
      };
      await exportGroupedExcel(columns, data, opt.key, opt.label, meta, `${fileName}-by-${opt.key}`);
      toast({ title: 'Export Successful', description: `Exported grouped Excel by ${opt.label}` });
    } catch {
      toast({ title: 'Export Failed', description: 'Failed to generate grouped Excel', variant: 'destructive' });
    }
  };

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={!data || data.length === 0} className="no-print">
          <Download className="h-4 w-4 mr-2" />Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-background z-50">
        <DropdownMenuLabel>Export Format</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={exportExcel} className="cursor-pointer">
          <FileSpreadsheet className="h-4 w-4 mr-2" />Export as Excel
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportCSV} className="cursor-pointer">
          <FileText className="h-4 w-4 mr-2" />Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportPDF} className="cursor-pointer">
          <FileDown className="h-4 w-4 mr-2" />Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportDocx} className="cursor-pointer">
          <FileType className="h-4 w-4 mr-2" />Export as DOCX
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handlePrint} className="cursor-pointer">
          <Printer className="h-4 w-4 mr-2" />Print
        </DropdownMenuItem>

        {groupByOptions && groupByOptions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <FileDown className="h-4 w-4 mr-2" />Grouped Report (PDF)
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="bg-background">
                  {groupByOptions.map(opt => (
                    <DropdownMenuItem key={opt.key} onClick={() => handleGroupedPDF(opt)} className="cursor-pointer">
                      By {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <FileSpreadsheet className="h-4 w-4 mr-2" />Grouped Report (Excel)
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="bg-background">
                  {groupByOptions.map(opt => (
                    <DropdownMenuItem key={opt.key} onClick={() => handleGroupedExcel(opt)} className="cursor-pointer">
                      By {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
