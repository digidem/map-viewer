import { type AddProtocolAction } from "maplibre-gl";

const cacheControl = "max-age=300"; // 5 mins

export default function createProtocolHandler(
  getResource: (url: string) => Promise<ArrayBuffer>,
): AddProtocolAction {
  return async ({ url, type }) => {
    try {
      const data = await getResource(url);
      if (type === "json") {
        return { data: JSON.parse(new TextDecoder().decode(data)), cacheControl };
      } else if (type === "string") {
        return { data: new TextDecoder().decode(data), cacheControl };
      }
      return { data, cacheControl };
    } catch (error) {
      // Missing tiles are expected outside a tileset's coverage; styles, sprites and glyphs are not
      if (type === "json" || type === "string") throw error;
      // Returning empty data renders nothing, so without this a broken package looks like an empty map
      console.warn(`Could not load ${url}:`, error);
      return { data: undefined };
    }
  };
}
