import type { SelectOption } from '../../components/SearchableSelect';

// Menus & features available in the app — used by the Complaint form dropdown.
export const APP_MENUS: SelectOption[] = [
  { value: 'Dashboard', label: 'Dashboard' },
  { value: 'Master Data', label: 'Master Data' },
  { value: 'Materials', label: 'Master Data › Materials' },
  { value: 'Warehouses', label: 'Master Data › Warehouses' },
  { value: 'Bins', label: 'Master Data › Bins' },
  { value: 'Vendors', label: 'Master Data › Vendors' },
  { value: 'Customers', label: 'Master Data › Customers' },
  { value: 'Inbound - MRN', label: 'Inbound › MRN' },
  { value: 'Inbound - Goods Receive', label: 'Inbound › Goods Receive' },
  { value: 'Inbound - Putaway', label: 'Inbound › Putaway' },
  { value: 'Outbound - Sales Order', label: 'Outbound › Sales Order' },
  { value: 'Outbound - Picking', label: 'Outbound › Picking' },
  { value: 'Outbound - Packing', label: 'Outbound › Packing' },
  { value: 'Outbound - Delivery', label: 'Outbound › Delivery' },
  { value: 'Inventory', label: 'Inventory' },
  { value: 'Discrepancy', label: 'Discrepancy' },
  { value: 'Users', label: 'User Management › Users' },
  { value: 'Roles', label: 'User Management › Roles' },
  { value: 'Complaint', label: 'Complaint' },
  { value: 'Other', label: 'Other' },
];
