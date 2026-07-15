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
}

export interface ReportSummaryItem {
  label: string;
  value: string | number;
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
  errors: string[];
}

export interface ReportImplementation {
  getDefinition(): ReportDefinition;
  run(filters: Record<string, string>): Promise<ReportExecutionResult>;
}
