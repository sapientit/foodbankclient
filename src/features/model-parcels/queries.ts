import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { components, paths } from '../../api/schema';
import { unwrap, unwrapVoid } from '../../api/unwrap';
import { modelParcelKeys } from './keys';
import { sortModelParcels } from './model-parcels.logic';

/**
 * The only import boundary for model parcels and the household grid.
 *
 * **There is no `GET /model-parcels/{id}`**, only a list, a create, an amend
 * and a delete — the same shape as stock items and users, and for the same
 * reason: the amend screen is a projection over the one cached list rather
 * than a fetch of its own.
 *
 * The grid, by contrast, genuinely is its own resource (`GET`/`PUT
 * /parcel-grid`), and the preview (`POST /parcel-grid/preview`) is neither
 * cached nor invalidated — it is a what-if question with no state of its own,
 * so it is a mutation rather than a query, run on demand from a button rather
 * than live as someone types.
 */

export type ModelParcel = components['schemas']['ModelParcel'];
export type ParcelContentLine = components['schemas']['ParcelContentLine'];

type CreateBody =
  paths['/api/v1/model-parcels']['post']['requestBody']['content']['application/json'];
export type CreateModelParcelInput = CreateBody;

type PatchBody =
  paths['/api/v1/model-parcels/{id}']['patch']['requestBody']['content']['application/json'];
export type AmendModelParcelInput = PatchBody;

/**
 * The `grid` object itself: `{ "1-0": "Single parcel", … }`, sparse — a
 * missing key means that cell has never been set, not that it is set to
 * nothing.
 */
export type Grid = Readonly<Record<string, string>>;

type GridResponse =
  paths['/api/v1/parcel-grid']['get']['responses']['200']['content']['application/json'];

type PreviewBody =
  paths['/api/v1/parcel-grid/preview']['post']['requestBody']['content']['application/json'];
export type PreviewInput = PreviewBody;

export type PreviewResult =
  paths['/api/v1/parcel-grid/preview']['post']['responses']['200']['content']['application/json'];

async function fetchModelParcels(): Promise<ModelParcel[]> {
  const { modelParcels } = await unwrap(api.GET('/api/v1/model-parcels'));
  return sortModelParcels(modelParcels);
}

export function useModelParcels() {
  return useQuery({ queryKey: modelParcelKeys.list(), queryFn: fetchModelParcels });
}

/** A projection over the one list query — see the module comment for why there is no single-item `GET`. */
export function useModelParcel(id: string) {
  return useQuery({
    queryKey: modelParcelKeys.list(),
    queryFn: fetchModelParcels,
    select: (parcels: ModelParcel[]) => parcels.find((parcel) => parcel.id === id) ?? null,
  });
}

export function useCreateModelParcel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateModelParcelInput): Promise<ModelParcel> =>
      unwrap(api.POST('/api/v1/model-parcels', { body: input })),
    onSuccess: () => {
      // The grid's dropdown options come from this same list, so a parcel
      // just created has to be selectable the moment this screen is left —
      // see `keys.ts` for why both sub-trees fall under one root.
      void queryClient.invalidateQueries({ queryKey: modelParcelKeys.all });
    },
  });
}

export function useAmendModelParcel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: AmendModelParcelInput;
    }): Promise<ModelParcel> =>
      unwrap(api.PATCH('/api/v1/model-parcels/{id}', { params: { path: { id } }, body: patch })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: modelParcelKeys.all });
    },
  });
}

export function useDeleteModelParcel() {
  const queryClient = useQueryClient();

  return useMutation({
    /*
     * **204, so `unwrapVoid`.** The `409` refusal ("still used by the
     * household grid") carries a `details.cells` list on a running server,
     * but `openapi.yaml` declares this response `content?: never` — genuinely
     * undocumented rather than merely unread — so nothing here parses it.
     * `ErrorNotice` shows the message, which is the part the contract
     * actually promises.
     */
    mutationFn: (id: string) =>
      unwrapVoid(api.DELETE('/api/v1/model-parcels/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: modelParcelKeys.all });
    },
  });
}

async function fetchParcelGrid(): Promise<GridResponse> {
  return unwrap(api.GET('/api/v1/parcel-grid'));
}

export function useParcelGrid() {
  return useQuery({ queryKey: modelParcelKeys.grid(), queryFn: fetchParcelGrid });
}

/**
 * Replace the grid, whole. There is no per-cell endpoint and this hook does
 * not offer one: see `buildGridPayload` in `model-parcels.logic.ts`, which is
 * what turns a draft into the single object this sends.
 *
 * **`unwrapVoid`, because nothing here needs the body — not because there
 * isn't one.** `openapi.yaml` declares this `200` with no content at all, but
 * verified against a running server: it actually echoes the saved grid back.
 * This screen already has that value, in the draft it just sent, so there is
 * nothing to gain from reading the response and `unwrapVoid` is the right
 * call regardless of which of the two the server does.
 */
export function useSaveParcelGrid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (grid: Grid) => unwrapVoid(api.PUT('/api/v1/parcel-grid', { body: { grid } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: modelParcelKeys.grid() });
    },
  });
}

/**
 * "What would this household receive?" — a mutation, not a query: nothing
 * about the answer is cached or invalidated, it runs once per click of a
 * Preview button, and the same `{ adults, children }` asked twice (say, after
 * editing the grid) should genuinely ask again rather than reading a stale
 * TanStack Query cache entry keyed on numbers that have not changed.
 *
 * **Runs the same lookup pick-list generation will use.** Nothing here
 * recomputes which model parcel a household maps to — that would be exactly
 * the divergence this endpoint exists to prevent.
 */
export function usePreviewHousehold() {
  return useMutation({
    mutationFn: (input: PreviewInput): Promise<PreviewResult> =>
      unwrap(api.POST('/api/v1/parcel-grid/preview', { body: input })),
  });
}
