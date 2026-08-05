/**
 * The query keys the model-parcels module owns. One root, the same reasoning as
 * `stockKeys`.
 *
 * The list of model parcels and the household grid are two different server
 * resources, but they are not independent: the grid holds a parcel's **name**,
 * not its id, so creating or deleting a parcel changes which names the grid can
 * legally hold. A team lead — or rather, an admin, since this whole feature is
 * admin only — adding a parcel expects it to show up as a choice on the grid
 * screen immediately, and deleting one is refused by the server while the grid
 * still points at it, so the two screens have to agree about what currently
 * exists. Two disjoint roots could invalidate one without the other, which is
 * exactly the failure `stockKeys` was written to avoid — see its comment.
 */
export const modelParcelKeys = {
  all: ['model-parcels'] as const,
  list: () => [...modelParcelKeys.all, 'list'] as const,
  grid: () => [...modelParcelKeys.all, 'grid'] as const,
};
