import type { StockPrototypeState } from './types';

/**
 * Seed data for the demo. Deliberately small and legible rather than realistic in volume — this is
 * shown to the charity to explain a mechanism, not to simulate their real catalogue. Two groupings
 * (non-perishables, fresh goods) per planning doc §1; one commingled shelf ("spread": marmite + two
 * jam sizes) to demonstrate a crate; one stacked-cans item to demonstrate a packing unit; one
 * deliberately uncounted item and one deliberately double-counted item, so the Validation screen has
 * something to show on first load.
 */
export const INITIAL_STOCK_PROTOTYPE_STATE: StockPrototypeState = {
  groupings: [
    { id: 'grp-non-perishable', name: 'Non-perishables' },
    { id: 'grp-fresh', name: 'Fresh goods' },
  ],
  items: [
    {
      id: 'item-marmite',
      name: 'Marmite 250g',
      category: 'Spreads',
      shelfNumber: 'F9',
      quantityOnHand: 18,
      unitsPerPack: null,
      packUnitLabel: null,
      groupingId: null,
    },
    {
      id: 'item-jam-small',
      name: 'Jam, small jar',
      category: 'Spreads',
      shelfNumber: 'F9',
      quantityOnHand: 24,
      unitsPerPack: null,
      packUnitLabel: null,
      groupingId: null,
    },
    {
      id: 'item-jam-large',
      name: 'Jam, large jar',
      category: 'Spreads',
      shelfNumber: 'F9',
      quantityOnHand: 6,
      unitsPerPack: null,
      packUnitLabel: null,
      groupingId: null,
    },
    {
      id: 'item-beans',
      name: 'Baked beans, 400g',
      category: 'Tinned goods',
      shelfNumber: 'B3',
      quantityOnHand: 96,
      unitsPerPack: 24,
      // Deliberately not the generic "packs" default, to demonstrate the counting-unit name.
      packUnitLabel: 'cases',
      groupingId: 'grp-non-perishable',
    },
    {
      id: 'item-pasta',
      name: 'Pasta, 500g',
      category: 'Dried goods',
      shelfNumber: 'D1',
      quantityOnHand: 40,
      unitsPerPack: null,
      packUnitLabel: null,
      groupingId: 'grp-non-perishable',
    },
    {
      id: 'item-teabags-80',
      name: 'Teabags, box of 80',
      category: 'Drinks',
      shelfNumber: 'T2a',
      quantityOnHand: 15,
      unitsPerPack: null,
      packUnitLabel: null,
      groupingId: 'grp-non-perishable',
    },
    {
      id: 'item-teabags-240',
      name: 'Teabags, box of 240',
      category: 'Drinks',
      shelfNumber: 'T2b',
      quantityOnHand: 5,
      unitsPerPack: null,
      packUnitLabel: null,
      groupingId: 'grp-non-perishable',
    },
    {
      id: 'item-bread',
      name: 'Sliced bread',
      category: 'Bakery',
      shelfNumber: 'F1',
      quantityOnHand: 12,
      unitsPerPack: null,
      packUnitLabel: null,
      groupingId: 'grp-fresh',
    },
    {
      id: 'item-cheese',
      name: 'Cheese, block',
      category: 'Dairy',
      shelfNumber: 'F4',
      quantityOnHand: 9,
      unitsPerPack: null,
      packUnitLabel: null,
      // Deliberately uncounted, to show on the Validation screen.
      groupingId: null,
    },
    {
      id: 'item-rice',
      name: 'Rice, 1kg',
      category: 'Dried goods',
      shelfNumber: 'D2',
      quantityOnHand: 30,
      unitsPerPack: null,
      packUnitLabel: null,
      groupingId: 'grp-non-perishable',
    },
  ],
  crates: [
    {
      id: 'crate-spread',
      name: 'Spread',
      shelfKey: 'F9',
      groupingId: 'grp-non-perishable',
      sizePerCrate: 48,
      members: [
        {
          stockItemId: 'item-marmite',
          stockCompositionPercent: 40,
          shoppingCompositionPercent: 50,
        },
        {
          stockItemId: 'item-jam-small',
          stockCompositionPercent: 40,
          shoppingCompositionPercent: 40,
        },
        // Deliberately missing item-jam-large — that item ends up counted by neither mechanism,
        // so the Validation screen has a live "not counted" case on first load.
        //
        // Also deliberately includes rice, whose shelf (D2) does not match this crate's key (F9),
        // and which also carries its own direct grouping above — together these demonstrate both
        // the member-shelf-mismatch check and the double-counted check on first load.
        { stockItemId: 'item-rice', stockCompositionPercent: 20, shoppingCompositionPercent: 10 },
      ],
    },
  ],
  itemTargets: [
    { stockItemId: 'item-pasta', target: 60 },
    { stockItemId: 'item-teabags-80', target: 20 },
  ],
  // In crates, the same unit as the crate's computed reference figure (currently ~1.5 crates from
  // the seeded member quantities) — a target of 2 gives a believable, modest shortfall to decompose,
  // rather than the wildly oversized shopping lines an unrealistic target would produce.
  crateTargets: [{ crateId: 'crate-spread', target: 2 }],
};
