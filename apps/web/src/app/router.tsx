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
import { AccountPage } from '../account/AccountPage.js';
import { RouteErrorBoundary } from './RouteErrorBoundary.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    // Catches anything the per-child boundaries below do not, including a
    // failure in AppShell itself.
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <DashboardPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'issues', element: <IssuesPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'assets', element: <AssetsPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'scans', element: <ScansPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'scans/new', element: <NewScanWizardPage />, errorElement: <RouteErrorBoundary /> },
      {
        path: 'scans/:scanRunId',
        element: <ScanRunDetailPage />,
        errorElement: <RouteErrorBoundary />,
      },
      { path: 'scope', element: <ScopePage />, errorElement: <RouteErrorBoundary /> },
      { path: 'exceptions', element: <ExceptionsPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'reports', element: <ReportsPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'admin', element: <AdminPage />, errorElement: <RouteErrorBoundary /> },
      // Every signed-in user, whatever their role — this is where someone
      // turns on a second factor voluntarily when the appliance is not
      // forcing it (MFA_ENFORCEMENT=optional).
      { path: 'account', element: <AccountPage />, errorElement: <RouteErrorBoundary /> },
    ],
  },
]);
