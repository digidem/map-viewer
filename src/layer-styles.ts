import type { LayerSpecification } from "maplibre-gl";

var lightColors = [
  "FC49A3", // pink
  "CC66FF", // purple-ish
  "66CCFF", // sky blue
  "66FFCC", // teal
  "00FF00", // lime green
  "FFCC66", // light orange
  "FF6666", // salmon
  "FF0000", // red
  "FF8000", // orange
  "FFFF66", // yellow
  "00FFFF", // turquoise
];

function randomColor(colors: string[]) {
  var randomNumber = Math.floor(Math.random() * colors.length);
  return colors[randomNumber];
}

export function* layerStyles(
  vectorLayers: { id: string }[],
  sourceId: string,
): Iterable<LayerSpecification> {
  for (const layer of vectorLayers) {
    var layerColor = "#" + randomColor(lightColors);

    yield {
      id: `${layer.id}-polygons`,
      type: "fill",
      source: sourceId,
      "source-layer": `${layer.id}`,
      filter: ["==", "$type", "Polygon"],
      layout: {},
      paint: {
        "fill-opacity": 0.1,
        "fill-color": layerColor,
      },
    };

    yield {
      id: `${layer.id}-polygons-outline`,
      type: "line",
      source: sourceId,
      "source-layer": `${layer.id}`,
      filter: ["==", "$type", "Polygon"],
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": layerColor,
        "line-width": 1,
        "line-opacity": 0.75,
      },
    };

    yield {
      id: `${layer.id}-lines`,
      type: "line",
      source: sourceId,
      "source-layer": `${layer.id}`,
      filter: ["==", "$type", "LineString"],
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": layerColor,
        "line-width": 1,
        "line-opacity": 0.75,
      },
    };

    yield {
      id: `${layer.id}-pts`,
      type: "circle",
      source: sourceId,
      "source-layer": `${layer.id}`,
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-color": layerColor,
        "circle-radius": 2.5,
        "circle-opacity": 0.75,
      },
    };
  }
}
