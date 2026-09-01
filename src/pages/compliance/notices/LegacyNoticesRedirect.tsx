/**
 * Legacy `/compliance/enforcement/notices` entry point.
 *
 * The legacy NoticesManagement screen has been retired; the canonical surface
 * is the Notice Register. Existing links (menu items, dashboards, Employer 360
 * `?regno=`, `?notice=<id>` deep links) are preserved by forwarding the full
 * query string.
 */
import { Navigate, useLocation } from 'react-router-dom';

export default function LegacyNoticesRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/compliance/notices/register${search}`} replace />;
}
