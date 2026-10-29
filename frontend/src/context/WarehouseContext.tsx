import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import api, { ACTIVE_WAREHOUSE_KEY } from '../lib/api';
import { useAuth } from './AuthContext';
import type { WarehouseOption } from '../types';

interface WarehouseContextValue {
  warehouses: WarehouseOption[];
  activeWarehouseId: string | null;
  activeWarehouseName: string | null;
  /** A non-admin's assigned warehouses, all seen together (empty for an admin). */
  assignedWarehouses: WarehouseOption[];
  canSwitch: boolean; // admin only
  setActiveWarehouse: (id: string) => void;
  ready: boolean;
}

const WarehouseContext = createContext<WarehouseContextValue | undefined>(
  undefined,
);

// Sentinel stored when an admin explicitly chooses "All sites" (no filter).
const ALL_SENTINEL = '__all__';

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [activeWarehouseId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) {
      setReady(false);
      setWarehouses([]);
      setActiveId(null);
      return;
    }

    let active = true;
    api
      .get<WarehouseOption[]>('/warehouses/options')
      .then((r) => {
        if (!active) return;
        const list = Array.isArray(r.data) ? r.data : [];
        setWarehouses(list);

        if (isAdmin) {
          // Admin default is "All sites" (no filter). A specific warehouse is
          // used only if the admin previously selected one.
          const stored = localStorage.getItem(ACTIVE_WAREHOUSE_KEY);
          const chosen =
            stored && stored !== ALL_SENTINEL && list.some((w) => w.id === stored)
              ? stored
              : null;
          setActiveId(chosen);
          if (!chosen) localStorage.setItem(ACTIVE_WAREHOUSE_KEY, ALL_SENTINEL);
        } else {
          // Non-admin: always every assigned warehouse together; never send
          // the override. "Active" only when there is exactly one.
          localStorage.removeItem(ACTIVE_WAREHOUSE_KEY);
          setActiveId(user.warehouseIds.length === 1 ? user.warehouseIds[0] : null);
        }
      })
      .catch(() => active && setWarehouses([]))
      .finally(() => active && setReady(true));

    return () => {
      active = false;
    };
  }, [user, isAdmin]);

  // id === '' → "All sites" (no warehouse filter).
  function setActiveWarehouse(id: string) {
    if (!isAdmin) return;
    if (id) {
      localStorage.setItem(ACTIVE_WAREHOUSE_KEY, id);
      setActiveId(id);
    } else {
      localStorage.setItem(ACTIVE_WAREHOUSE_KEY, ALL_SENTINEL);
      setActiveId(null);
    }
  }

  const assignedWarehouses = useMemo(
    () => (isAdmin || !user ? [] : warehouses.filter((w) => user.warehouseIds.includes(w.id))),
    [warehouses, user, isAdmin],
  );

  const activeWarehouseName = useMemo(() => {
    const one = (Array.isArray(warehouses) ? warehouses : []).find((w) => w.id === activeWarehouseId)?.name;
    if (one) return one;
    return assignedWarehouses.length > 1 ? `${assignedWarehouses.length} warehouses` : null;
  }, [warehouses, activeWarehouseId, assignedWarehouses]);

  return (
    <WarehouseContext.Provider
      value={{
        warehouses,
        activeWarehouseId,
        activeWarehouseName,
        assignedWarehouses,
        canSwitch: isAdmin,
        setActiveWarehouse,
        ready,
      }}
    >
      {children}
    </WarehouseContext.Provider>
  );
}

export function useWarehouse() {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error('useWarehouse must be used within WarehouseProvider');
  return ctx;
}
