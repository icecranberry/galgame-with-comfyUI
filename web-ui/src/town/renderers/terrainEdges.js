// Small visible curb volumes. They do not alter the logical walk grid or tile height.
export function roadEdges(map) {
  const edges = []
  const road = map?.layers?.road
  for (let y = 0; y < (map?.rows || 0); y++) for (let x = 0; x < map.cols; x++) {
    if (!road?.[y]?.[x]) continue
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows || road?.[ny]?.[nx]) continue
      edges.push({ x: x + .5 + dx * .5, z: y + .5 + dy * .5, turn: !!dx })
    }
  }
  return edges
}
