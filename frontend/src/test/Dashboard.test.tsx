import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Dashboard from '../pages/Dashboard';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Fadlan Test', role: 'admin' },
    has: () => true,
  }),
}));

vi.mock('../context/WarehouseContext', () => ({
  useWarehouse: () => ({
    activeWarehouseName: 'Main Warehouse',
  }),
}));

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders welcome greeting with user name', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Hello, Fadlan/i)).toBeInTheDocument();
  });

  it('renders company badge', () => {
    render(<Dashboard />);
    expect(screen.getByText('PT Indonesia Equipment Line')).toBeInTheDocument();
  });

  it('renders warehouse name', () => {
    render(<Dashboard />);
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
  });

  it('renders Quick Access heading', () => {
    render(<Dashboard />);
    expect(screen.getByText('Quick Access')).toBeInTheDocument();
  });

  it('renders all three module cards', () => {
    render(<Dashboard />);
    expect(screen.getByText('Inbound Management')).toBeInTheDocument();
    expect(screen.getByText('Outbound Management')).toBeInTheDocument();
    expect(screen.getByText('Inventory Management')).toBeInTheDocument();
  });

  it('navigates when Inbound card is clicked', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Inbound Management'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/inbound');
  });

  it('navigates when Outbound card is clicked', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Outbound Management'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/outbound');
  });

  it('navigates when Inventory card is clicked', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Inventory Management'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/inventory');
  });

  it('displays date/time badge with WIB', () => {
    render(<Dashboard />);
    expect(screen.getByText(/WIB/i)).toBeInTheDocument();
  });

  it('shows Open Module link on each card', () => {
    render(<Dashboard />);
    const links = screen.getAllByText('Open Module →');
    expect(links).toHaveLength(3);
  });
});
