import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { DashboardPage } from '../dashboard/DashboardPage.js';
import { IssuesPage } from '../issues/IssuesPage.js';
import { AssetsPage } from '../assets/AssetsPage.js';
import { ScansPage } from '../scans/ScansPage.js';
import { NewScanWizardPage } from '../scans/NewScanWizardPage.js';
import { ScanRunDetailPage } from '../scans/ScanRunDetailPage.js';
import { ScopePage } from '../scope/ScopePage.js';
import { ExceptionsPage } from '../exceptions/ExceptionsPage.js';
import { ReportsPage } from '../reports/ReportsPage.js';
import { AdminPage } from '../admin/AdminPage.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'issues', element: <IssuesPage /> },
      { path: 'assets', element: <AssetsPage /> },
      { path: 'scans', element: <ScansPage /> },
      { path: 'scans/new', element: <NewScanWizardPage /> },
      { path: 'scans/:scanRunId', element: <ScanRunDetailPage /> },
      { path: 'scope', element: <ScopePage /> },
      { path: 'exceptions', element: <ExceptionsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'admin', element: <AdminPage /> },
    ],
  },
]);
