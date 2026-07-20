import { Controller, Get, Header, Query } from '@nestjs/common';
import { AppEventLevel } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from './modules/prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getUiRoot() {
    return this.renderAppShell();
  }

  @Get('ui')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getUi() {
    return this.renderAppShell();
  }

  @Get('ui/api/events')
  async getUiEvents(
    @Query('level') level?: string,
    @Query('source') source?: string,
    @Query('entityKey') entityKey?: string,
    @Query('q') searchText?: string,
    @Query('limit') limit?: string,
  ) {
    await this.ensureMaterialReviewEvents();

    const rows = await this.prisma.appEvent.findMany({
      where: {
        ...(level ? { level: level as never } : {}),
        ...(source ? { source: { contains: source } } : {}),
        ...(entityKey ? { entityKey } : {}),
        ...(searchText
          ? {
              OR: [
                { title: { contains: searchText } },
                { message: { contains: searchText } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(limit ?? 50), 1), 200),
    });

    return rows.map((row) => ({
      ...row,
      id: String(row.id),
    }));
  }

  private async ensureMaterialReviewEvents() {
    const flaggedRows = await this.prisma.cmTreatment.findMany({
      where: {
        materialStock: true,
        manualReviewNeeded: true,
      },
      select: {
        id: true,
        externalId: true,
        treatment: true,
        brand: true,
        unit: true,
        locationId: true,
      },
    });

    for (const row of flaggedRows) {
      const message = `Material treatment requires manual review because it exists in invoice usage but not in stock inventory: ${row.externalId}`;
      const existing = await this.prisma.appEvent.findFirst({
        where: {
          source: 'ClinicmindsStageService',
          entityKey: 'cmMaterialTreatment',
          title: 'Invoice-only material treatment detected',
          message,
        },
        select: { id: true },
      });

      if (existing) {
        continue;
      }

      await this.prisma.appEvent.create({
        data: {
          level: AppEventLevel.ERROR,
          source: 'ClinicmindsStageService',
          entityKey: 'cmMaterialTreatment',
          title: 'Invoice-only material treatment detected',
          message,
          payload: {
            treatmentId: String(row.id),
            externalId: row.externalId,
            treatment: row.treatment,
            brand: row.brand,
            unit: row.unit,
            locationId: row.locationId,
            manualReviewNeeded: true,
            inventoryConfirmed: false,
          },
        },
      });
    }
  }

  @Get('help')
  getHelp() {
    return {
      name: 'MESQ Clinicminds Test App',
      execution: this.configService.get('execution'),
      routes: [
        { method: 'GET', path: '/', description: 'Basic MESQ admin UI with Reporting and Administration sections.' },
        { method: 'GET', path: '/ui', description: 'Basic MESQ admin UI with Reporting and Administration sections.' },
        { method: 'GET', path: '/ui/api/events', description: 'Returns persisted application events for the Event Viewer.' },
        { method: 'GET', path: '/reports', description: 'Lists implemented reports and their filter definitions.' },
        { method: 'GET', path: '/reports/:reportKey', description: 'Returns one report definition.' },
        { method: 'POST', path: '/reports/:reportKey/run', description: 'Runs a report preview with submitted filters.' },
        { method: 'GET', path: '/reports/:reportKey/download', description: 'Downloads a generated report in a supported format such as CSV.' },
        { method: 'GET', path: '/help', description: 'Application help and quick route listing.' },
        { method: 'GET', path: '/health/mysql', description: 'Checks the MySQL connection with SELECT 1.' },
        { method: 'GET', path: '/clinicminds/spec', description: 'Returns the loaded Clinicminds API spec summary.' },
        { method: 'GET', path: '/clinicminds/patients', description: 'Requests Clinicminds patients with query filters and logs patient count.' },
        { method: 'GET', path: '/clinicminds/records', description: 'Requests Clinicminds records and logs record count.' },
        { method: 'GET', path: '/clinicminds/quotes', description: 'Requests Clinicminds quotes and logs quote count.' },
        { method: 'GET', path: '/clinicminds/treatment-material-stock', description: 'Requests Clinicminds treatment material stock snapshot for one configured location.' },
        { method: 'GET', path: '/clinicminds/endpoints', description: 'Lists supported Clinicminds operations from the local OpenAPI spec.' },
        { method: 'GET', path: '/clinicminds/endpoints/:operationId', description: 'Returns metadata for a single Clinicminds operation.' },
        { method: 'GET', path: '/clinicminds/sync/entities', description: 'Lists sync entities loaded from config/entities.config.json.' },
        { method: 'GET', path: '/clinicminds/sync/runs', description: 'Lists recent sync runs stored in MySQL.' },
        { method: 'GET', path: '/clinicminds/raw', description: 'Lists raw imported rows from the single raw storage table.' },
        { method: 'GET', path: '/clinicminds/stage/entities', description: 'Lists implemented stage entities.' },
        { method: 'GET', path: '/clinicminds/stage/runs', description: 'Lists stage conversion runs stored in MySQL.' },
        { method: 'GET', path: '/clinicminds/stage/patients', description: 'Lists staged patient rows from the cm_patient table.' },
        { method: 'GET', path: '/clinicminds/stage/records', description: 'Lists staged record rows from the cm_record table.' },
        { method: 'GET', path: '/clinicminds/stage/invoices', description: 'Lists staged invoice rows together with pivot child rows.' },
        { method: 'GET', path: '/clinicminds/stage/quotes', description: 'Lists staged quote rows from the cm_quote table.' },
        { method: 'GET', path: '/clinicminds/stage/treatments', description: 'Lists staged treatment rows sourced from Clinicminds material stock and future treatment sources.' },
        { method: 'POST', path: '/clinicminds/stage/:entityKey', description: 'Runs stage conversion for one entity.' },
        { method: 'POST', path: '/clinicminds/sync/:entityKey', description: 'Runs config-driven sync for one entity and stores raw JSON rows.' },
        { method: 'POST', path: '/clinicminds/sync', description: 'Runs config-driven sync for all enabled entities or an explicit entity list.' },
        { method: 'GET', path: '/clinicminds/request/:operationId', description: 'Calls a Clinicminds operation with query-string params.' },
        { method: 'POST', path: '/clinicminds/request', description: 'Calls a Clinicminds operation with a JSON body.' },
      ],
    };
  }

  private renderAppShell() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MESQ Analytics Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef2f6;
      --panel: #ffffff;
      --panel-soft: #f7f9fb;
      --sidebar: #0f1720;
      --sidebar-muted: #8b9ab0;
      --sidebar-active: #1f6feb;
      --text: #15202b;
      --muted: #5b6776;
      --border: #d7e0ea;
      --error: #c03844;
      --warn: #b7791f;
      --info: #1f6feb;
      --shadow: 0 18px 50px rgba(15, 23, 32, 0.08);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: linear-gradient(135deg, #edf3f9 0%, #f8fafc 100%); color: var(--text); }
    .app-shell { min-height: 100vh; display: grid; grid-template-columns: 280px minmax(0, 1fr); }
    .sidebar { background: linear-gradient(180deg, #0f1720 0%, #152332 100%); color: #fff; padding: 28px 20px; }
    .brand { font-size: 1.35rem; font-weight: 700; letter-spacing: 0.02em; }
    .brand-note { margin-top: 6px; color: var(--sidebar-muted); font-size: 0.92rem; }
    .nav-group { margin-top: 28px; }
    .nav-group-title { display: block; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--sidebar-muted); margin-bottom: 10px; }
    .nav-item { width: 100%; border: 0; background: transparent; color: #dce6f2; text-align: left; padding: 11px 14px; border-radius: 12px; cursor: pointer; font-size: 0.96rem; margin-bottom: 6px; }
    .nav-item:hover { background: rgba(255,255,255,0.08); }
    .nav-item.active { background: linear-gradient(135deg, rgba(31,111,235,0.95), rgba(41,134,255,0.8)); color: #fff; box-shadow: 0 10px 24px rgba(31,111,235,0.25); }
    .nav-item.disabled { opacity: 0.58; cursor: default; }
    .content { padding: 32px; }
    .page-panel { background: rgba(255,255,255,0.88); border: 1px solid rgba(215,224,234,0.7); border-radius: 24px; box-shadow: var(--shadow); min-height: calc(100vh - 64px); overflow: hidden; }
    .page-header { padding: 28px 32px 18px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%); }
    .page-title { margin: 0; font-size: 1.7rem; }
    .page-subtitle { margin: 8px 0 0; color: var(--muted); max-width: 760px; line-height: 1.5; }
    .page-body { padding: 24px 32px 32px; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field label { font-size: 0.84rem; color: var(--muted); }
    .field input, .field select { width: 100%; border: 1px solid var(--border); border-radius: 12px; background: #fff; padding: 10px 12px; font-size: 0.95rem; }
    .btn { align-self: end; border: 0; border-radius: 12px; background: #1f6feb; color: #fff; padding: 10px 16px; font-size: 0.95rem; cursor: pointer; }
    .stats-row { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
    .summary-table-wrap { border: 1px solid var(--border); border-radius: 20px; overflow: hidden; background: #fff; }
    .summary-table th, .summary-table td { white-space: normal; }
    .summary-separator-row td { background: #e8eef6; height: 12px; padding: 0; border-bottom: 1px solid var(--border); }
    .summary-table th:nth-child(2), .summary-table th:nth-child(3), .summary-table td:nth-child(2), .summary-table td:nth-child(3) { text-align: right; }
    .details-panel[hidden] { display: none; }
    .details-back-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .details-title { margin: 0; font-size: 1.2rem; }
    .details-table-wrap { border: 1px solid var(--border); border-radius: 20px; overflow: hidden; background: #fff; }
    .details-section-row td { background: #e5e7eb; font-weight: 700; color: #334155; }
    .report-row-clickable { cursor: pointer; }
    .report-row-clickable:hover td { background: #f8fbff; }
    .report-group-row td { background: #e8eef6; color: #1e293b; font-weight: 700; letter-spacing: 0.02em; }
    .report-tabs { display: flex; gap: 10px; margin-bottom: 18px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    .report-tab { border: 1px solid var(--border); background: #fff; color: var(--muted); border-radius: 999px; padding: 9px 14px; cursor: pointer; font-size: 0.92rem; }
    .report-tab.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
    .report-tab-panel[hidden] { display: none; }
    .stat-card { background: var(--panel-soft); border: 1px solid var(--border); border-radius: 18px; padding: 14px 16px; min-width: 140px; }
    .stat-label { display: block; color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .stat-value { display: block; margin-top: 6px; font-size: 1.4rem; font-weight: 700; }
    .table-wrap { border: 1px solid var(--border); border-radius: 20px; overflow: auto; background: #fff; max-height: 560px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 14px 16px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { background: #f8fbff; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); white-space: pre-line; position: sticky; top: 0; z-index: 2; }
    td { font-size: 0.94rem; }
    tr:last-child td { border-bottom: 0; }
    .level-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; }
    .level-ERROR { background: rgba(192, 56, 68, 0.12); color: var(--error); }
    .level-WARN { background: rgba(183, 121, 31, 0.12); color: var(--warn); }
    .level-INFO { background: rgba(31, 111, 235, 0.12); color: var(--info); }
    .muted { color: var(--muted); }
    .placeholder { display: grid; place-items: center; min-height: 320px; border: 1px dashed var(--border); border-radius: 22px; background: linear-gradient(135deg, #fbfcfd 0%, #f4f7fa 100%); text-align: center; padding: 32px; }
    .placeholder h2 { margin: 0 0 12px; font-size: 1.35rem; }
    .placeholder p { margin: 0; color: var(--muted); max-width: 520px; line-height: 1.6; }
    .event-payload { white-space: pre-wrap; font-family: Consolas, 'Courier New', monospace; font-size: 0.8rem; color: #334155; background: #f8fafc; border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; max-height: 160px; overflow: auto; }
    .top-strip { display: flex; justify-content: space-between; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
    .top-strip-note { color: var(--muted); max-width: 640px; }
    .report-workspace { border: 1px solid var(--border); border-radius: 20px; background: #fff; padding: 20px; }
    .report-actions { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; align-items: center; }
    .btn-secondary { align-self: end; border: 1px solid var(--border); border-radius: 12px; background: #fff; color: var(--text); padding: 10px 16px; font-size: 0.95rem; cursor: pointer; text-decoration: none; }
    .btn-secondary[aria-disabled="true"] { opacity: 0.55; pointer-events: none; }
    .report-meta { margin-bottom: 18px; }
    .report-meta h2 { margin: 0 0 8px; font-size: 1.35rem; }
    .report-meta p { margin: 0; color: var(--muted); line-height: 1.6; }
    .hint { color: var(--muted); font-size: 0.86rem; line-height: 1.45; }
    .nav-report-item { width: 100%; border: 0; background: transparent; color: #dce6f2; text-align: left; padding: 11px 14px; border-radius: 12px; cursor: pointer; font-size: 0.96rem; margin-bottom: 6px; }
    .nav-report-item:hover { background: rgba(255,255,255,0.08); }
    .nav-report-item.active { background: linear-gradient(135deg, rgba(31,111,235,0.95), rgba(41,134,255,0.8)); color: #fff; box-shadow: 0 10px 24px rgba(31,111,235,0.25); }
    .report-primary-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .btn-ghost { border: 1px solid var(--border); border-radius: 12px; background: #fff; color: var(--text); padding: 10px 14px; font-size: 0.9rem; cursor: pointer; }
    .download-block { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .download-options { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .download-option { display: inline-flex; gap: 6px; align-items: center; color: var(--text); }
    .download-option input[disabled] + span, .download-option.disabled { color: var(--muted); }
    .report-errors { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
    .report-error { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; width: 100%; background: #c03844; color: #fff; border-radius: 14px; padding: 12px 14px; }
    .report-error-text { line-height: 1.45; }
    .report-error-dismiss { border: 0; background: transparent; color: #fff; font-size: 1rem; cursor: pointer; padding: 0; }
    @media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 860px) {
      .app-shell { grid-template-columns: 1fr; }
      .sidebar { padding-bottom: 12px; }
      .content { padding: 16px; }
      .page-panel { min-height: auto; }
      .filters { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">MESQ Analytics</div>
      <div class="brand-note">Clinicminds reporting and administration workspace.</div>
      <div class="nav-group">
        <span class="nav-group-title">Reporting</span>
        <div id="report-nav-items">
          <div class="muted">Loading reports...</div>
        </div>
      </div>
      <div class="nav-group">
        <span class="nav-group-title">Administration</span>
        <button class="nav-item" data-page="event-viewer">Event Viewer</button>
      </div>
    </aside>
    <main class="content">
      <section class="page-panel">
        <div class="page" data-page-id="reporting-home">
          <div class="page-header">
            <h1 class="page-title" id="report-name">Select a report</h1>
            <p class="page-subtitle" id="report-description">Choose a report from the left navigation to preview it, adjust filters, and download the result.</p>
          </div>
          <div class="page-body">
            <div class="report-workspace">
              <div class="filters" id="report-filters"></div>
              <div class="report-actions">
                <div class="report-primary-actions">
                  <button class="btn-ghost" id="set-last-month" type="button">Last month</button>
                  <button class="btn-ghost" id="set-previous-month" type="button">Month before last month</button>
                  <button class="btn" id="run-report-inline" type="button">Preview</button>
                </div>
                <div class="download-block">
                  <div class="download-options">
                    <label class="download-option">
                      <input type="radio" name="report-download-format" value="csv" />
                      <span>.csv</span>
                    </label>
                    <label class="download-option">
                      <input type="radio" name="report-download-format" value="xlsx" checked disabled />
                      <span>Excel</span>
                    </label>
                    <label class="download-option">
                      <input type="radio" name="report-download-format" value="pdf" disabled />
                      <span>.pdf</span>
                    </label>
                  </div>
                  <a class="btn-secondary" id="download-report" href="#" aria-disabled="true">Download</a>
                </div>
              </div>
              <div class="report-errors" id="report-errors"></div>
              <div class="report-tabs">
                <button class="report-tab active" type="button" data-report-tab="invoice-list">Invoice list</button>
                <button class="report-tab" type="button" data-report-tab="summary">Summary</button>
              </div>
              <div class="report-tab-panel" data-report-tab-panel="invoice-list">
                <div id="report-list-panel">
                  <div class="table-wrap">
                    <table>
                      <thead id="report-head"></thead>
                      <tbody id="report-body">
                        <tr><td class="muted">Select a report to start.</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <p class="hint" id="report-generated"></p>
                </div>
                <div class="details-panel" id="invoice-details-panel" hidden>
                  <div class="details-back-row">
                    <button class="btn-ghost" id="close-invoice-details" type="button">Return</button>
                    <h2 class="details-title" id="invoice-details-title">Invoice details</h2>
                  </div>
                  <div class="details-table-wrap">
                    <table>
                      <tbody id="invoice-details-body">
                        <tr><td class="muted">Click an invoice row to open details.</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div class="report-tab-panel" data-report-tab-panel="summary" hidden>
                <div class="summary-table-wrap">
                  <table class="summary-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Number</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody id="report-summary"></tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="page" data-page-id="event-viewer" hidden>
          <div class="page-header">
            <h1 class="page-title">Event Viewer</h1>
            <p class="page-subtitle">Review persisted application events, including important runtime notes and error events such as invoice-only material treatments that need manual review.</p>
          </div>
          <div class="page-body">
            <div class="top-strip">
              <div class="top-strip-note">Use the filters to focus on one severity level, source, or entity. The viewer reads persisted events from MySQL, so it is independent from temporary container logs.</div>
              <button class="btn" id="refresh-events">Refresh</button>
            </div>
            <div class="filters">
              <div class="field">
                <label for="event-level">Level</label>
                <select id="event-level">
                  <option value="">All</option>
                  <option value="ERROR">ERROR</option>
                  <option value="WARN">WARN</option>
                  <option value="INFO">INFO</option>
                </select>
              </div>
              <div class="field">
                <label for="event-source">Source</label>
                <input id="event-source" placeholder="ClinicmindsStageService" />
              </div>
              <div class="field">
                <label for="event-entity">Entity</label>
                <input id="event-entity" placeholder="cmInvoice" />
              </div>
              <div class="field">
                <label for="event-search">Search</label>
                <input id="event-search" placeholder="invoice-only material" />
              </div>
              <button class="btn" id="apply-filters">Apply</button>
            </div>
            <div class="stats-row">
              <div class="stat-card"><span class="stat-label">Loaded</span><span class="stat-value" id="events-count">0</span></div>
              <div class="stat-card"><span class="stat-label">Errors</span><span class="stat-value" id="events-errors">0</span></div>
              <div class="stat-card"><span class="stat-label">Warnings</span><span class="stat-value" id="events-warnings">0</span></div>
              <div class="stat-card"><span class="stat-label">Info</span><span class="stat-value" id="events-info">0</span></div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style="width: 120px;">Level</th>
                    <th style="width: 190px;">Time</th>
                    <th style="width: 190px;">Source</th>
                    <th style="width: 140px;">Entity</th>
                    <th style="width: 220px;">Title</th>
                    <th>Message / Payload</th>
                  </tr>
                </thead>
                <tbody id="events-body">
                  <tr><td colspan="6" class="muted">Loading events...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
  <script>
    const navItems = Array.from(document.querySelectorAll('.nav-item'));
    const pages = Array.from(document.querySelectorAll('.page'));
    const eventsBody = document.getElementById('events-body');
    const levelInput = document.getElementById('event-level');
    const sourceInput = document.getElementById('event-source');
    const entityInput = document.getElementById('event-entity');
    const searchInput = document.getElementById('event-search');
    const applyButton = document.getElementById('apply-filters');
    const refreshButton = document.getElementById('refresh-events');
    const reportNavItems = document.getElementById('report-nav-items');
    const reportName = document.getElementById('report-name');
    const reportDescription = document.getElementById('report-description');
    const reportFilters = document.getElementById('report-filters');
    const reportSummary = document.getElementById('report-summary');
    const reportErrors = document.getElementById('report-errors');
    const reportHead = document.getElementById('report-head');
    const reportBody = document.getElementById('report-body');
    const downloadReportLink = document.getElementById('download-report');
    const reportGenerated = document.getElementById('report-generated');
    const reportListPanel = document.getElementById('report-list-panel');
    const invoiceDetailsPanel = document.getElementById('invoice-details-panel');
    const invoiceDetailsTitle = document.getElementById('invoice-details-title');
    const invoiceDetailsBody = document.getElementById('invoice-details-body');
    const closeInvoiceDetailsButton = document.getElementById('close-invoice-details');
    const downloadFormatInputs = Array.from(document.querySelectorAll('input[name="report-download-format"]'));
    const reportTabButtons = Array.from(document.querySelectorAll('[data-report-tab]'));
    const reportTabPanels = Array.from(document.querySelectorAll('[data-report-tab-panel]'));

    let availableReports = [];
    let selectedReport = null;
    let selectedReportDetails = {};

    function showPage(pageId) {
      navItems.forEach((item) => item.classList.toggle('active', item.dataset.page === pageId));
      pages.forEach((page) => {
        page.hidden = page.dataset.pageId !== pageId;
      });
      if (pageId === 'event-viewer') {
        loadEvents();
      }
      if (pageId === 'reporting-home') {
        loadReports();
      }
    }

    async function loadReports() {
      if (availableReports.length > 0) {
        return;
      }

      reportNavItems.innerHTML = '<div class="muted">Loading reports...</div>';
      const response = await fetch('/reports');
      availableReports = await response.json();

      if (availableReports.length === 0) {
        reportNavItems.innerHTML = '<div class="muted">No reports are implemented yet.</div>';
        return;
      }

      renderReportList();
      selectReport(availableReports[0].key);
    }

    function activateReportTab(tabKey) {
      reportTabButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.reportTab === tabKey);
      });
      reportTabPanels.forEach((panel) => {
        panel.hidden = panel.dataset.reportTabPanel !== tabKey;
      });
    }

    function closeInvoiceDetails() {
      invoiceDetailsPanel.hidden = true;
      reportListPanel.hidden = false;
    }

    function openInvoiceDetails(rowKey) {
      const sections = selectedReportDetails[rowKey];
      if (!sections || !Array.isArray(sections)) {
        return;
      }

      invoiceDetailsTitle.textContent = selectedReport?.key === 'quotes-report'
        ? 'Детали квоты: ' + rowKey
        : 'Invoice details: ' + rowKey;
      invoiceDetailsBody.innerHTML = sections.map((section) => {
        const headerRow = '<tr class="details-section-row"><td colspan="' + section.columns.length + '">' + escapeHtml(section.title) + '</td></tr>';
        const showColumnHeader = !(selectedReport?.key === 'quotes-report' && section.columns.length === 2 && section.columns[0] === 'Поле' && section.columns[1] === 'Значение');
        const columnHeaderRow = showColumnHeader
          ? '<tr>' + section.columns.map((column) => '<th>' + escapeHtml(column) + '</th>').join('') + '</tr>'
          : '';
        const rows = (section.rows || []).map((row) => '<tr>' + row.columns.map((value, index) => '<td>' + escapeHtml(formatDetailCellValue(section, index, value)) + '</td>').join('') + '</tr>').join('');
        return headerRow + columnHeaderRow + rows;
      }).join('');

      reportListPanel.hidden = true;
      invoiceDetailsPanel.hidden = false;
    }

    function renderReportList() {
      reportNavItems.innerHTML = availableReports.map((report) => [
        '<button class="nav-report-item' + (selectedReport && selectedReport.key === report.key ? ' active' : '') + '" type="button" data-page="reporting-home" data-report-key="' + escapeHtml(report.key) + '">',
        escapeHtml(report.name),
        '</button>'
      ].join('')).join('');

      Array.from(document.querySelectorAll('.nav-report-item')).forEach((item) => {
        item.addEventListener('click', () => {
          showPage('reporting-home');
          selectReport(item.dataset.reportKey);
        });
      });
    }

    function selectReport(reportKey) {
      selectedReport = availableReports.find((item) => item.key === reportKey) || null;
      renderReportList();

      if (!selectedReport) {
        reportName.textContent = 'Select a report';
        reportDescription.textContent = 'Choose a report from the list to preview it, adjust filters, and download the result.';
        reportFilters.innerHTML = '';
        reportErrors.innerHTML = '';
        reportSummary.innerHTML = '';
        reportHead.innerHTML = '';
        reportBody.innerHTML = '<tr><td class="muted">Select a report to start.</td></tr>';
        activateReportTab('invoice-list');
        downloadReportLink.setAttribute('aria-disabled', 'true');
        downloadReportLink.setAttribute('href', '#');
        return;
      }

      reportName.textContent = selectedReport.name;
      reportDescription.textContent = selectedReport.description;
      reportFilters.innerHTML = selectedReport.filters.map((filter) => {
        if (filter.type === 'select') {
          const options = (filter.options || []).map((option) => '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>').join('');

          return [
            '<div class="field">',
            '<label for="filter-' + escapeHtml(filter.key) + '">' + escapeHtml(filter.label) + '</label>',
            '<select id="filter-' + escapeHtml(filter.key) + '" data-filter-key="' + escapeHtml(filter.key) + '">',
            options,
            '</select>',
            filter.helpText ? '<div class="hint">' + escapeHtml(filter.helpText) + '</div>' : '',
            '</div>'
          ].join('');
        }

        return [
          '<div class="field">',
          '<label for="filter-' + escapeHtml(filter.key) + '">' + escapeHtml(filter.label) + '</label>',
          '<input id="filter-' + escapeHtml(filter.key) + '" data-filter-key="' + escapeHtml(filter.key) + '" type="' + escapeHtml(filter.type === 'date' ? 'date' : 'text') + '" value="' + escapeHtml(filter.defaultValue || '') + '" placeholder="' + escapeHtml(filter.placeholder || '') + '" ' + (filter.required ? 'required' : '') + ' />',
          filter.helpText ? '<div class="hint">' + escapeHtml(filter.helpText) + '</div>' : '',
          '</div>'
        ].join('');
      }).join('');

      reportErrors.innerHTML = '';
      reportSummary.innerHTML = '';
      reportHead.innerHTML = '';
      reportBody.innerHTML = '<tr><td class="muted">Click "Preview" to load data.</td></tr>';
      reportGenerated.textContent = '';
      selectedReportDetails = {};
      closeInvoiceDetails();
      activateReportTab('invoice-list');
      updateDownloadOptions();
      updateDownloadLink();
      document.getElementById('set-last-month')?.addEventListener('click', () => setRelativeMonthRange(-1));
      document.getElementById('set-previous-month')?.addEventListener('click', () => setRelativeMonthRange(-2));
      document.getElementById('run-report-inline')?.addEventListener('click', runSelectedReport);
    }

    function collectReportFilters() {
      const values = {};
      Array.from(reportFilters.querySelectorAll('[data-filter-key]')).forEach((element) => {
        const key = element.dataset.filterKey;
        const value = element.value || '';
        if (value) {
          values[key] = value;
        }
      });
      return values;
    }
    function setDateInputRange(fromDate, toDate) {
      const dateInputs = Array.from(reportFilters.querySelectorAll('input[type="date"][data-filter-key]'));
      if (dateInputs.length < 2) {
        return;
      }

      dateInputs[0].value = fromDate;
      dateInputs[1].value = toDate;
      updateDownloadLink();
    }

    function formatDateForInput(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return year + '-' + month + '-' + day;
    }

    function setRelativeMonthRange(monthOffset) {
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0);
      setDateInputRange(formatDateForInput(firstDay), formatDateForInput(lastDay));
    }


    function updateDownloadOptions() {
      const supportedFormats = selectedReport?.supportedFormats || [];
      downloadFormatInputs.forEach((input) => {
        const isSupported = supportedFormats.includes(input.value);
        input.disabled = !isSupported;
        if (!isSupported && input.checked) {
          const firstSupported = downloadFormatInputs.find((item) => supportedFormats.includes(item.value));
          if (firstSupported) {
            firstSupported.checked = true;
          }
        }
      });
    }

    function updateDownloadLink() {
      if (!selectedReport) {
        downloadReportLink.setAttribute('aria-disabled', 'true');
        downloadReportLink.setAttribute('href', '#');
        return;
      }

      const params = new URLSearchParams();
      const selectedFormat = downloadFormatInputs.find((input) => input.checked)?.value || 'xlsx';
      params.set('format', selectedFormat);
      const filters = collectReportFilters();
      Object.entries(filters).forEach(([key, value]) => params.set(key, value));
      downloadReportLink.setAttribute('href', '/reports/' + encodeURIComponent(selectedReport.key) + '/download?' + params.toString());
      downloadReportLink.setAttribute('aria-disabled', 'false');
    }

    async function runSelectedReport() {
      if (!selectedReport) {
        return;
      }

      const filters = collectReportFilters();
      updateDownloadLink();
      reportBody.innerHTML = '<tr><td class="muted">Loading report preview...</td></tr>';

      const response = await fetch('/reports/' + encodeURIComponent(selectedReport.key) + '/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(filters),
      });
      const result = await response.json();

      renderReportErrors(result.errors || []);
      selectedReportDetails = result.detailSectionsByRowKey || {};
      closeInvoiceDetails();

      const summaryRows = result.summaryRows || (result.summary || []).map((item) => ({
        label: item.label,
        number: null,
        amount: item.value,
      }));
      reportSummary.innerHTML = summaryRows.map((item) => {
        if (item.label === '__separator__') {
          return '<tr class="summary-separator-row"><td colspan="3"></td></tr>';
        }
        return [
          '<tr>',
          '<td>' + escapeHtml(item.label) + '</td>',
          '<td>' + escapeHtml(item.number ?? '') + '</td>',
          '<td>' + escapeHtml(formatCurrencyValue(item.amount)) + '</td>',
          '</tr>'
        ].join('');
      }).join('');

      reportHead.innerHTML = '<tr>' + result.columns.map((column) => '<th>' + escapeHtml(column.label) + '</th>').join('') + '</tr>';

      if (!result.rows || result.rows.length === 0) {
        reportBody.innerHTML = '<tr><td colspan="' + Math.max(result.columns.length, 1) + '" class="muted">No rows returned for the selected filters.</td></tr>';
      } else {
        reportBody.innerHTML = renderReportRows(result);

        Array.from(reportBody.querySelectorAll('[data-report-detail-key]')).forEach((rowElement) => {
          rowElement.addEventListener('click', () => openInvoiceDetails(rowElement.dataset.reportDetailKey));
        });
      }

      reportGenerated.textContent = 'Generated at ' + new Date(result.generatedAt).toLocaleString();
    }

    function renderReportRows(result) {
      const columnCount = Math.max(result.columns.length, 1);
      const getRowDetailKey = (row) => {
        if (selectedReport?.key === 'invoice-amounts') {
          return row.invoiceNumber;
        }
        if (selectedReport?.key === 'quotes-report') {
          return row.quoteNumber;
        }
        return row.id || row.key || null;
      };
      const renderDataRow = (row) => {
        const rowKey = getRowDetailKey(row);
        const isClickable = Boolean(rowKey && selectedReportDetails[rowKey]);
        return '<tr' + (isClickable ? ' class="report-row-clickable" data-report-detail-key="' + escapeHtml(rowKey) + '"' : '') + '>' + result.columns
          .map((column) => '<td>' + escapeHtml(formatReportCellValue(column, row[column.key])) + '</td>')
          .join('') + '</tr>';
      };

      if (selectedReport?.key !== 'quotes-report') {
        return result.rows.map((row) => renderDataRow(row)).join('');
      }

      let currentCreator = null;
      return result.rows.map((row) => {
        const parts = [];
        const creator = row.creator || 'Создатель не указан';
        if (creator !== currentCreator) {
          currentCreator = creator;
          parts.push('<tr class="report-group-row"><td colspan="' + columnCount + '">' + escapeHtml(creator) + '</td></tr>');
        }
        parts.push(renderDataRow(row));
        return parts.join('');
      }).join('');
    }

    function formatCurrencyValue(value) {
      if (value === null || value === undefined || value === '') {
        return '';
      }

      const numericValue = Number(value);
      if (Number.isNaN(numericValue)) {
        return String(value);
      }

      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(numericValue);
    }

    function isCurrencyDetailLabel(label) {
      const normalized = String(label || '').toLowerCase();
      return normalized.includes('vat')
        || normalized.includes('price')
        || normalized.includes('cost')
        || normalized.includes('paid')
        || normalized.includes('total');
    }

    function formatReportCellValue(column, value) {
      if (column?.format === 'currency') {
        return formatCurrencyValue(value);
      }

      return value ?? '';
    }

    function formatDetailCellValue(section, index, value) {
      const label = section?.columns?.[index] || '';
      if (isCurrencyDetailLabel(label)) {
        return formatCurrencyValue(value);
      }

      return value ?? '';
    }

    function renderReportErrors(errors) {
      if (!errors || errors.length === 0) {
        reportErrors.innerHTML = '';
        return;
      }

      reportErrors.innerHTML = errors.map((message, index) => [
        '<div class="report-error" data-report-error-index="' + index + '">',
        '<div class="report-error-text">' + escapeHtml(message) + '</div>',
        '<button class="report-error-dismiss" type="button" data-report-error-dismiss="' + index + '">X</button>',
        '</div>'
      ].join('')).join('');

      Array.from(reportErrors.querySelectorAll('[data-report-error-dismiss]')).forEach((button) => {
        button.addEventListener('click', () => {
          button.closest('.report-error')?.remove();
        });
      });
    }

    async function loadEvents() {
      eventsBody.innerHTML = '<tr><td colspan="6" class="muted">Loading events...</td></tr>';
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (levelInput.value) params.set('level', levelInput.value);
      if (sourceInput.value.trim()) params.set('source', sourceInput.value.trim());
      if (entityInput.value.trim()) params.set('entityKey', entityInput.value.trim());
      if (searchInput.value.trim()) params.set('q', searchInput.value.trim());

      const response = await fetch('/ui/api/events?' + params.toString());
      const rows = await response.json();

      document.getElementById('events-count').textContent = String(rows.length);
      document.getElementById('events-errors').textContent = String(rows.filter((row) => row.level === 'ERROR').length);
      document.getElementById('events-warnings').textContent = String(rows.filter((row) => row.level === 'WARN').length);
      document.getElementById('events-info').textContent = String(rows.filter((row) => row.level === 'INFO').length);

      if (rows.length === 0) {
        eventsBody.innerHTML = '<tr><td colspan="6" class="muted">No events match the current filters.</td></tr>';
        return;
      }

      eventsBody.innerHTML = rows.map((row) => {
        const payload = row.payload ? '<div class="event-payload">' + escapeHtml(JSON.stringify(row.payload, null, 2)) + '</div>' : '';
        return [
          '<tr>',
          '<td><span class="level-pill level-' + escapeHtml(row.level) + '">' + escapeHtml(row.level) + '</span></td>',
          '<td>' + escapeHtml(new Date(row.createdAt).toLocaleString()) + '</td>',
          '<td>' + escapeHtml(row.source) + '</td>',
          '<td>' + escapeHtml(row.entityKey || '') + '</td>',
          '<td>' + escapeHtml(row.title) + '</td>',
          '<td><div>' + escapeHtml(row.message) + '</div>' + payload + '</td>',
          '</tr>'
        ].join('');
      }).join('');
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    navItems.forEach((item) => {
      item.addEventListener('click', () => {
        if (item.classList.contains('disabled')) {
          return;
        }
        showPage(item.dataset.page);
      });
    });

    closeInvoiceDetailsButton?.addEventListener('click', closeInvoiceDetails);
    reportTabButtons.forEach((button) => {
      button.addEventListener('click', () => activateReportTab(button.dataset.reportTab));
    });
    reportFilters?.addEventListener('change', updateDownloadLink);
    downloadFormatInputs.forEach((input) => input.addEventListener('change', updateDownloadLink));
    applyButton?.addEventListener('click', loadEvents);
    refreshButton?.addEventListener('click', loadEvents);
    void loadReports();
  </script>
</body>
</html>`;
  }

  @Get('health/mysql')
  async getMysqlHealth() {
    const rows = (await this.prisma.$queryRawUnsafe('SELECT 1 AS ok')) as Array<{
      ok: bigint | number;
    }>;

    return {
      status: 'ok',
      database: 'mysql',
      result: rows.map((row) => ({
        ok: Number(row.ok),
      })),
    };
  }
}
