import { Outlet } from 'react-router-dom';

/**
 * Outbound from Transfer Stock. The module's tabs live in the header bar (see
 * components/admin/moduleTabs.ts), as on WMS dev; this only renders the page.
 */
export default function TransferStockLayout() {
  return <Outlet />;
}
