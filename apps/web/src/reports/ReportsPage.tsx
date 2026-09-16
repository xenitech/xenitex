import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { Button } from '../components/form/Button.js';
import { Field, Select } from '../components/form/Field.js';
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
  const create = useCreateReportMutation();

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
                  {report.status === 'completed' && (
                    <a href={`/v1/reports/${report.id}/download`}>{t('reports.download')}</a>
                  )}
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
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                { template, formats: ['html', 'csv', 'json'] },
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
