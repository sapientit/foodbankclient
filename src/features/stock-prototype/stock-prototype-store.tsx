import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { INITIAL_STOCK_PROTOTYPE_STATE } from './mock-data';
import type {
  Crate,
  CrateTargetLine,
  Grouping,
  ItemTargetLine,
  ProtoStockItem,
  StockPrototypeState,
} from './types';

/**
 * In-memory only, on purpose — see `README.md`. This stands in for the TanStack Query cache a real
 * implementation would have, so every prototype screen reads and writes through the same shape a
 * real `queries.ts` would expose, and none of it survives a reload.
 */
interface StockPrototypeStore {
  readonly state: StockPrototypeState;
  readonly setItemGrouping: (stockItemId: string, groupingId: string | null) => void;
  readonly setItemUnitsPerPack: (stockItemId: string, unitsPerPack: number | null) => void;
  readonly setItemPackUnitLabel: (stockItemId: string, packUnitLabel: string | null) => void;
  readonly saveGrouping: (grouping: Grouping) => void;
  readonly saveCrate: (crate: Crate) => void;
  readonly deleteCrate: (crateId: string) => void;
  readonly applyStockCounts: (
    counts: readonly { stockItemId: string; quantityOnHand: number }[],
  ) => void;
  readonly setItemTarget: (stockItemId: string, target: number | null) => void;
  readonly setCrateTarget: (crateId: string, target: number | null) => void;
}

const Context = createContext<StockPrototypeStore | null>(null);

export function StockPrototypeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StockPrototypeState>(INITIAL_STOCK_PROTOTYPE_STATE);

  const setItemGrouping = useCallback((stockItemId: string, groupingId: string | null) => {
    setState((current) => ({
      ...current,
      items: current.items.map((item): ProtoStockItem =>
        item.id === stockItemId ? { ...item, groupingId } : item,
      ),
    }));
  }, []);

  const setItemUnitsPerPack = useCallback((stockItemId: string, unitsPerPack: number | null) => {
    setState((current) => ({
      ...current,
      items: current.items.map((item): ProtoStockItem =>
        item.id === stockItemId ? { ...item, unitsPerPack } : item,
      ),
    }));
  }, []);

  const setItemPackUnitLabel = useCallback((stockItemId: string, packUnitLabel: string | null) => {
    setState((current) => ({
      ...current,
      items: current.items.map((item): ProtoStockItem =>
        item.id === stockItemId ? { ...item, packUnitLabel } : item,
      ),
    }));
  }, []);

  const saveGrouping = useCallback((grouping: Grouping) => {
    setState((current) => {
      const exists = current.groupings.some((g) => g.id === grouping.id);
      return {
        ...current,
        groupings: exists
          ? current.groupings.map((g) => (g.id === grouping.id ? grouping : g))
          : [...current.groupings, grouping],
      };
    });
  }, []);

  const saveCrate = useCallback((crate: Crate) => {
    setState((current) => {
      const exists = current.crates.some((c) => c.id === crate.id);
      return {
        ...current,
        crates: exists
          ? current.crates.map((c) => (c.id === crate.id ? crate : c))
          : [...current.crates, crate],
      };
    });
  }, []);

  const deleteCrate = useCallback((crateId: string) => {
    setState((current) => ({
      ...current,
      crates: current.crates.filter((c) => c.id !== crateId),
      crateTargets: current.crateTargets.filter((t) => t.crateId !== crateId),
    }));
  }, []);

  const applyStockCounts = useCallback(
    (counts: readonly { stockItemId: string; quantityOnHand: number }[]) => {
      setState((current) => {
        const byId = new Map(counts.map((c) => [c.stockItemId, c.quantityOnHand]));
        return {
          ...current,
          items: current.items.map((item): ProtoStockItem => {
            const quantityOnHand = byId.get(item.id);
            return quantityOnHand === undefined ? item : { ...item, quantityOnHand };
          }),
        };
      });
    },
    [],
  );

  const setItemTarget = useCallback((stockItemId: string, target: number | null) => {
    setState((current) => {
      const withoutLine = current.itemTargets.filter((t) => t.stockItemId !== stockItemId);
      const nextLine: ItemTargetLine[] = target === null ? [] : [{ stockItemId, target }];
      return { ...current, itemTargets: [...withoutLine, ...nextLine] };
    });
  }, []);

  const setCrateTarget = useCallback((crateId: string, target: number | null) => {
    setState((current) => {
      const withoutLine = current.crateTargets.filter((t) => t.crateId !== crateId);
      const nextLine: CrateTargetLine[] = target === null ? [] : [{ crateId, target }];
      return { ...current, crateTargets: [...withoutLine, ...nextLine] };
    });
  }, []);

  const value = useMemo<StockPrototypeStore>(
    () => ({
      state,
      setItemGrouping,
      setItemUnitsPerPack,
      setItemPackUnitLabel,
      saveGrouping,
      saveCrate,
      deleteCrate,
      applyStockCounts,
      setItemTarget,
      setCrateTarget,
    }),
    [
      state,
      setItemGrouping,
      setItemUnitsPerPack,
      setItemPackUnitLabel,
      saveGrouping,
      saveCrate,
      deleteCrate,
      applyStockCounts,
      setItemTarget,
      setCrateTarget,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStockPrototypeStore(): StockPrototypeStore {
  const store = useContext(Context);
  if (store === null) {
    throw new Error('useStockPrototypeStore must be used within a StockPrototypeProvider');
  }
  return store;
}
