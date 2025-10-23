import { createDirectus, rest, staticToken, readItems } from "@directus/sdk";

const directusDomain = process.env.DIRECTUS_DOMAIN!;
const directusApiToken = process.env.DIRECTUS_API_TOKEN!;

export const directus = createDirectus(directusDomain)
  .with(rest())
  .with(staticToken(directusApiToken));

export async function fetchItems<T = any>(
  collectionName: string,
  query?: any
): Promise<T> {
  const result = await directus.request(readItems(collectionName, query));

  if (query?.limit === 1) {
    return (result as any)[0];
  }

  return result as T;
}
