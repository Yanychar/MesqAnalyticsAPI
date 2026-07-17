export type ReportFilterType = 'date' | 'text' | 'select';

export interface ReportFilterOption {
  value: string;
  label: string;
}

export interface ReportFilterDefinition {
  key: string;
  label: string;
  type: ReportFilterType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  defaultValue?: string;
  options?: ReportFilterOption[];
}

export interface ReportColumnDefinition {
  key: string;
  label: string;
  format?: 'text' | 'currency' | 'number';
}

export interface ReportSummaryItem {
  label: string;
  value: string | number;
  format?: 'text' | 'currency' | 'number';
}

export interface ReportSummaryRow {
  label: string;
  number?: string | number | null;
  amount?: string | number | null;
}

export interface ReportDetailRow {
  columns: Array<string | number | null>;
}

export interface ReportDetailSection {
  title: string;
  columns: string[];
  rows: ReportDetailRow[];
}

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  filters: ReportFilterDefinition[];
  supportedFormats: string[];
}

export interface ReportExecutionResult {
  reportKey: string;
  reportName: string;
  generatedAt: string;
  filters: Record<string, string>;
  columns: ReportColumnDefinition[];
  rows: Array<Record<string, string | number | boolean | null>>;
  summary: ReportSummaryItem[];
  summaryRows?: ReportSummaryRow[];
  detailSectionsByRowKey?: Record<string, ReportDetailSection[]>;
  errors: string[];
}

export interface ReportImplementation {
  getDefinition(): ReportDefinition;
  run(filters: Record<string, string>): Promise<ReportExecutionResult>;
}
