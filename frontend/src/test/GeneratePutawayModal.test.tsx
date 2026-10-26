import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import GeneratePutawayModal from '../components/GeneratePutawayModal';
import type { GoodsReceiveItem } from '../types';

const item = (id: string, code: string, remaining: number): GoodsReceiveItem => ({
  id,
  item_name: code,
  po_number: 'TO-1',
  vendor_name: null,
  item_description: `Material ${code}`,
  qty_expected: remaining,
  qty_actual: remaining,
  qty_remaining: remaining,
  bin_id: null,
  bin_label: null,
  receiving_location_name: null,
  material_code: code,
  uom: 'PCS',
});

const items = [item('a', 'PN-001', 5), item('b', 'PN-002', 3)];
const bins = [
  { id: 'bin-1', binLabel: 'Rack A-01', binCode: 'RA01', warehouseId: 'wh-1' },
  { id: 'bin-2', binLabel: 'Rack B-02', binCode: 'RB02', warehouseId: 'wh-1' },
];
const pickers = [{ id: 7, name: 'Picker Seven' }];

function open(onSubmit = vi.fn()) {
  render(
    <GeneratePutawayModal
      open
      grNumber="GR-TEST-001"
      items={items}
      bins={bins}
      pickers={pickers}
      submitting={false}
      onClose={() => {}}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

/** Open a SearchableSelect by its placeholder (the nth one) and pick an option. */
function choose(placeholder: string, option: string, nth = 0) {
  fireEvent.click(screen.getAllByText(placeholder)[nth]);
  fireEvent.click(screen.getByText(option));
}

describe('GeneratePutawayModal', () => {
  it('shows each material with its PN and UoM', () => {
    open();
    expect(screen.getByText('PN · PN-001')).toBeTruthy();
    expect(screen.getByText('PN · PN-002')).toBeTruthy();
    expect(screen.getAllByText('PCS')).toHaveLength(2);
    expect(screen.getByText(/GR-TEST-001/)).toBeTruthy();
  });

  it('needs a destination bin for every selected material', () => {
    const onSubmit = open();
    const save = screen.getByRole('button', { name: 'Generate Putaway' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Please select Destination Bin for all selected materials/)).toBeTruthy();

    choose('Select bin…', 'Rack A-01', 0);
    // One row still has no bin.
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('assigns one picker to every row and submits bin + picker per line', () => {
    const onSubmit = open();
    choose('Select bin…', 'Rack A-01', 0);
    choose('Select bin…', 'Rack B-02', 0); // the remaining unset row
    choose('Assign to all…', 'Picker Seven');

    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Picker Seven').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: 'Generate Putaway' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { itemId: 'a', plannedQty: 5, binId: 'bin-1', pickerId: 7 },
      { itemId: 'b', plannedQty: 3, binId: 'bin-2', pickerId: 7 },
    ]);
  });

  it('leaves out unticked materials', () => {
    const onSubmit = open();
    fireEvent.click(screen.getByLabelText('Select PN-002'));
    choose('Select bin…', 'Rack A-01', 0);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Putaway' }));
    expect(onSubmit).toHaveBeenCalledWith([{ itemId: 'a', plannedQty: 5, binId: 'bin-1', pickerId: undefined }]);
  });
});
