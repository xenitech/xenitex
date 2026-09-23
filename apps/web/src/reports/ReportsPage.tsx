import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { Button } from '../components/form/Button.js';
import { Field, Select, TextInput } from '../components/form/Field.js';
import { Dialog } from '../components/primitives/Dialog.js';
import { Stack } from '../components/layout/Stack.js';
import { ApiError } from '../api/error.js';
import { flattenPages } from '../api/pagination.js';
import type { ReportTemplate } from '../api/types.js';
import { useCreateReportMutation, useReportsQuery } from './useReportsQueries.js';
import styles from './ReportsPage.module.css';

const TEMPLATES: readonly ReportTemplate[] = ['executive_summary', 'technical_detail', 'delta'];

export function ReportsPage() {
  const { t } = useTranslation();
  const query = useReportsQuery();
  const reports = useMemo(() => flattenPages(query.data?.pages), [query.data]);
  const [isOpen, setIsOpen] = useState(false);
  const [template, setTemplate] = useState<ReportTemplate>('executive_summary');
  const [dateRangeStart, setDateRangeStart] = useState('');
  const [dateRangeEnd, setDateRangeEnd] = useState('');
  const create = useCreateReportMutation();

  // The delta template is defined as the difference between two dates, and
  // the server rejects it without them. The dialog previously offered the
  // template with no way to supply a range at all, so choosing it produced
  // a 400 the screen never showed.
  const needsDateRange = template === 'delta';
  const dateRangeError = !needsDateRange
    ? undefined
    : !dateRangeStart || !dateRangeEnd
      ? t('reports.dateRangeRequired')
      : dateRangeStart > dateRangeEnd
        ? t('reports.dateRangeOrder')
        : undefined;

  if (query.isError) {
    const apiErr = query.error instanceof ApiError ? query.error : undefined;
    return (
      <ErrorState
        title={t('components.errorState.title')}
        detail={apiErr?.detail ?? ''}
        code={apiErr?.code ?? 'unknown'}
        correlationId={apiErr?.correlationId ?? 'unavailable'}
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('reports.title')}</h1>
        <Button variant="primary" onClick={() => setIsOpen(true)}>
          {t('reports.newReport')}
        </Button>
      </div>
      {!query.isLoading && reports.length === 0 ? (
        <EmptyState title={t('reports.empty.title')} description={t('reports.empty.description')} />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('reports.columns.template')}</th>
              <th>{t('reports.columns.status')}</th>
              <th>{t('reports.columns.generatedBy')}</th>
              <th>{t('reports.columns.generatedAt')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id}>
                <td>{t(`reports.templates.${report.template}`)}</td>
                <td>{report.status}</td>
                <td>{report.generatedBy}</td>
                <td>{report.generatedAt}</td>
                <td>
                  {/* `format` is a required query parameter — the link
                      omitted it entirely and every download 400'd. One
                      link per format the report was actually generated in,
                      rather than one link that guesses. */}
                  {report.status === 'completed' &&
                    report.formats.map((format) => (
                      <a
                        key={format}
                        className={styles.downloadLink}
                        href={`/v1/reports/${report.id}/download?format=${format}`}
                      >
                        {t('reports.download')} ({format})
                      </a>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Dialog
        titleId="new-report-title"
        title={t('reports.newReport')}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <Stack>
          <Field label={t('reports.columns.template')}>
            <Select
              value={template}
              onChange={(e) => setTemplate(e.target.value as ReportTemplate)}
            >
              {TEMPLATES.map((tpl) => (
                <option key={tpl} value={tpl}>
                  {t(`reports.templates.${tpl}`)}
                </option>
              ))}
            </Select>
          </Field>
          {needsDateRange && (
            <>
              <Field label={t('reports.dateRangeStart')}>
                <TextInput
                  type="date"
                  value={dateRangeStart}
                  onChange={(e) => setDateRangeStart(e.target.value)}
                />
              </Field>
              <Field label={t('reports.dateRangeEnd')} error={dateRangeError}>
                <TextInput
                  type="date"
                  value={dateRangeEnd}
                  onChange={(e) => setDateRangeEnd(e.target.value)}
                />
              </Field>
            </>
          )}
          {create.isError && (
            <p role="alert" className={styles.error}>
              {create.error instanceof ApiError
                ? (create.error.detail ?? create.error.message)
                : t('reports.generateFailed')}
            </p>
          )}
          <Button
            variant="primary"
            disabled={create.isPending || Boolean(dateRangeError)}
            onClick={() =>
              create.mutate(
                {
                  template,
                  formats: ['html', 'csv', 'json'],
                  ...(needsDateRange ? { dateRangeStart, dateRangeEnd } : {}),
                },
                { onSuccess: () => setIsOpen(false) },
              )
            }
          >
            {t('reports.newReport')}
          </Button>
        </Stack>
      </Dialog>
    </div>
  );
}
