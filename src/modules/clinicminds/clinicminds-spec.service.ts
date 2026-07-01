import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ClinicmindsOpenApiSpec,
  ClinicmindsParameterDefinition,
  ClinicmindsReportDefinition,
} from './types/clinicminds-report.types';

@Injectable()
export class ClinicmindsSpecService {
  private readonly spec: ClinicmindsOpenApiSpec;
  private readonly endpoints: ClinicmindsReportDefinition[];
  private readonly endpointMap: Map<string, ClinicmindsReportDefinition>;

  constructor() {
    const specPath = resolve(process.cwd(), 'clinicminds-openapi.json');
    this.spec = JSON.parse(readFileSync(specPath, 'utf-8')) as ClinicmindsOpenApiSpec;
    this.endpoints = this.buildEndpoints();
    this.endpointMap = new Map(
      this.endpoints.map((endpoint) => [endpoint.operationId, endpoint]),
    );
  }

  getInfo() {
    return {
      info: this.spec.info,
      tags: this.spec.tags ?? [],
      endpointCount: this.endpoints.length,
    };
  }

  listEndpoints(): ClinicmindsReportDefinition[] {
    return this.endpoints;
  }

  getEndpoint(operationId: string): ClinicmindsReportDefinition | undefined {
    return this.endpointMap.get(operationId);
  }

  private buildEndpoints(): ClinicmindsReportDefinition[] {
    return Object.entries(this.spec.paths)
      .flatMap(([path, pathItem]) => {
        if (!pathItem.get?.operationId) {
          return [];
        }

        const responseRef = pathItem.get.responses?.['200']?.$ref ?? '';
        const responseType: ClinicmindsReportDefinition['responseType'] = responseRef.includes(
          'ArrayReport',
        )
          ? 'array'
          : responseRef.includes('ObjectReport')
            ? 'object'
            : 'unknown';
        const parameters: ClinicmindsParameterDefinition[] = (pathItem.get.parameters ?? []).map(
          (parameter) => ({
            name: parameter.name,
            in: parameter.in,
            required: Boolean(parameter.required),
            description: parameter.description,
            type: parameter.schema?.type,
            format: parameter.schema?.format,
            enumValues: parameter.schema?.enum,
          }),
        );

        return [
          {
            operationId: pathItem.get.operationId,
            path,
            method: 'get' as const,
            summary: pathItem.get.summary ?? pathItem.get.operationId,
            description: pathItem.get.description,
            tags: pathItem.get.tags ?? [],
            parameters,
            responseType,
          },
        ];
      })
      .sort((left, right) => left.operationId.localeCompare(right.operationId));
  }
}

