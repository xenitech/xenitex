import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/error.js';
import { Button } from '../components/form/Button.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { Stack } from '../components/layout/Stack.js';

/**
 * The route-level error element.
 *
 * `AppErrorBoundary` sits above `RouterProvider`, which sounds like it
 * should be enough — it is not. React Router catches render errors inside
 * its own routes first, and with no `errorElement` it falls back to its
 * built-in development screen: a raw stack trace, plus a note addressed to
 * the developer telling them to add this component. That is what a customer
 * saw when an issue carried a risk breakdown the explainer could not read.
 *
 * A half-built area of the product failing is acceptable at this stage. A
 * customer being shown a JavaScript stack trace, with no way back, is not —
 * so anything unexpected inside a route lands here instead, says plainly
 * that the area is unavailable, and leaves the navigation intact so the
 * rest of the appliance stays usable.
 */
export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const error = useRouteError();

  const apiError = error instanceof ApiError ? error : undefined;
  const routeResponse = isRouteErrorResponse(error) ? error : undefined;

  // The message is deliberately about availability rather than about the
  // fault: a stack trace or an exception message is not information a
  // security operator can act on, and it invites them to think the DATA is
  // wrong when it is the screen that is.
  const detail = apiError?.detail ?? t('components.errorState.unavailableDetail');

  return (
    <div style={{ padding: 'var(--space-9)' }}>
      <Stack>
        <ErrorState
          title={t('components.errorState.unavailableTitle')}
          detail={detail}
          code={
            apiError?.code ?? (routeResponse ? `http.${routeResponse.status}` : 'ui.unavailable')
          }
          correlationId={apiError?.correlationId ?? 'unavailable'}
        />
        <div>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            {t('common.back')}
          </Button>
        </div>
      </Stack>
    </div>
  );
}
