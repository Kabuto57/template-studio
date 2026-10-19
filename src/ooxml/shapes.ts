// Preset shapes the editor offers. `poly` is the outline in percent of the shape's box, used to
// draw it on screen and in the pickers; PowerPoint draws the real preset from `geom`.
// ponytail: fixed outlines ignore a preset's adjust handles; fine for shapes inserted here at default settings.
export interface ShapeDef { geom: string; label: string; poly: string; w: number; h: number }

export const SHAPES: ShapeDef[] = [
  { geom: "rect", label: "Square", poly: "0,0 100,0 100,100 0,100", w: 2, h: 2 },
  { geom: "triangle", label: "Triangle", poly: "50,0 100,100 0,100", w: 2, h: 1.8 },
  { geom: "rtTriangle", label: "Right triangle", poly: "0,0 100,100 0,100", w: 2, h: 2 },
  { geom: "diamond", label: "Diamond", poly: "50,0 100,50 50,100 0,50", w: 2, h: 2 },
  { geom: "parallelogram", label: "Parallelogram", poly: "25,0 100,0 75,100 0,100", w: 2.6, h: 1.6 },
  { geom: "trapezoid", label: "Trapezoid", poly: "25,0 75,0 100,100 0,100", w: 2.6, h: 1.6 },
  { geom: "pentagon", label: "Pentagon", poly: "50,0 100,38 81,100 19,100 0,38", w: 2, h: 2 },
  { geom: "hexagon", label: "Hexagon", poly: "25,0 75,0 100,50 75,100 25,100 0,50", w: 2.3, h: 2 },
  { geom: "octagon", label: "Octagon", poly: "29,0 71,0 100,29 100,71 71,100 29,100 0,71 0,29", w: 2, h: 2 },
  { geom: "star5", label: "Star", poly: "50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35", w: 2, h: 2 },
  { geom: "rightArrow", label: "Arrow right", poly: "0,25 60,25 60,0 100,50 60,100 60,75 0,75", w: 3, h: 1.4 },
  { geom: "leftArrow", label: "Arrow left", poly: "100,25 40,25 40,0 0,50 40,100 40,75 100,75", w: 3, h: 1.4 },
  { geom: "upArrow", label: "Arrow up", poly: "25,100 25,40 0,40 50,0 100,40 75,40 75,100", w: 1.4, h: 3 },
  { geom: "downArrow", label: "Arrow down", poly: "25,0 75,0 75,60 100,60 50,100 0,60 25,60", w: 1.4, h: 3 },
  { geom: "chevron", label: "Chevron", poly: "0,0 75,0 100,50 75,100 0,100 25,50", w: 2.6, h: 1.2 },
  { geom: "homePlate", label: "Step", poly: "0,0 80,0 100,50 80,100 0,100", w: 2.6, h: 1.2 },
  { geom: "plus", label: "Plus", poly: "35,0 65,0 65,35 100,35 100,65 65,65 65,100 35,100 35,65 0,65 0,35 35,35", w: 1.8, h: 1.8 },
  { geom: "wedgeRectCallout", label: "Speech bubble", poly: "0,0 100,0 100,80 45,80 20,100 25,80 0,80", w: 3, h: 2 },
];

export const shapeByGeom = (geom: string): ShapeDef | undefined => SHAPES.find(s => s.geom === geom);

/** A small SVG of a shape for buttons and pickers. */
export const shapeIcon = (s: ShapeDef, fill = "currentColor"): string =>
  `<svg viewBox="-4 -4 108 108" aria-hidden="true"><polygon points="${s.poly}" fill="${fill}"/></svg>`;
