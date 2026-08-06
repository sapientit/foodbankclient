import { ApiError } from '../lib/errors';

/**
 * `openapi-fetch` returns failures rather than throwing them. TanStack Query
 * wants the opposite, so this is the adapter, and it is the only place that
 * decides what "failed" means.
 */

/**
 * Structurally what `openapi-fetch` returns. Declared here rather than imported
 * so `unwrap` accepts any endpoint's result without the caller naming its
 * response type.
 */
type ApiResult<T> =
  | { data: T; error?: never; response: Response }
  | { data?: never; error: unknown; response: Response };

export async function unwrap<T>(call: Promise<ApiResult<T>>): Promise<T> {
  const { data, error, response } = await call;

  if (!response.ok) throw ApiError.from(response, error);

  if (data === undefined) {
    /*
     * A 204 lands here: `openapi-fetch` reports `data: undefined` with
     * `response.ok` true, so an unwrap that only checked `data` would throw on
     * success. `unwrapVoid` is the endpoint that means it. This branch is the
     * loud version of the same trap — a body was expected and there was none.
     */
    throw new ApiError({
      status: response.status,
      code: 'INTERNAL_ERROR',
      message: 'The server returned no content where a body was expected.',
      requestId: response.headers.get('x-request-id'),
      details: null,
    });
  }

  return data;
}

/**
 * For the endpoints that answer **204 No Content**: `POST /auth/logout`,
 * Endpoints such as `PUT /parcels/{id}/lines` that deliberately return no body.
 *
 * Passing one of those to `unwrap` throws on a perfectly successful request,
 * because `data` is `undefined` by design. This is the whole reason the two
 * functions exist separately, and there is a test named after it.
 */
export async function unwrapVoid(call: Promise<ApiResult<unknown>>): Promise<void> {
  const { error, response } = await call;

  if (!response.ok) throw ApiError.from(response, error);
}
