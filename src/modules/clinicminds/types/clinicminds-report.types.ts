export type ClinicmindsFormat = 'json' | 'csv' | 'scsv';

export interface ClinicmindsParameterDefinition {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  type?: string;
  format?: string;
  enumValues?: Array<string | number>;
}

export interface ClinicmindsReportDefinition {
  operationId: string;
  path: string;
  method: 'get';
  summary: string;
  description?: string;
  tags: string[];
  parameters: ClinicmindsParameterDefinition[];
  responseType: 'array' | 'object' | 'unknown';
}

export interface ClinicmindsRequestResult {
  operationId: string;
  requestPath: string;
  data: unknown;
}

export interface ClinicmindsOpenApiSpec {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  tags?: Array<{ name: string }>;
  paths: Record<
    string,
    {
      get?: {
        operationId?: string;
        summary?: string;
        description?: string;
        tags?: string[];
        parameters?: Array<{
          name: string;
          in: string;
          required?: boolean;
          description?: string;
          schema?: {
            type?: string;
            format?: string;
            enum?: Array<string | number>;
          };
        }>;
        responses?: Record<string, { $ref?: string }>;
      };
    }
  >;
}
