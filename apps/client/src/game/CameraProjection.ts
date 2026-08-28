export const ISO_ANGLE = Math.PI / 4;
export const ISO_VERTICAL_SCALE = 0.58;

export function projectWorld(x: number, y: number) {
  const cosine = Math.cos(ISO_ANGLE);
  const sine = Math.sin(ISO_ANGLE);
  return {
    x: x * cosine - y * sine,
    y: (x * sine + y * cosine) * ISO_VERTICAL_SCALE,
  };
}

export function unprojectWorld(x: number, y: number) {
  const cosine = Math.cos(ISO_ANGLE);
  const sine = Math.sin(ISO_ANGLE);
  const expandedY = y / ISO_VERTICAL_SCALE;
  return {
    x: x * cosine + expandedY * sine,
    y: -x * sine + expandedY * cosine,
  };
}
