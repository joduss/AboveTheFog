const cells = 250;
const tileSize = 256;

function weights(t: number) {return [(1-t)*(1-2*t),4*t*(1-t),t*(2*t-1)];}

// Each z13–19 tile lies inside one z12 page. Evaluate its inverse projection
// from a 3x3 control mesh per z14 patch. Double precision preserves 4 m edges.
export function nativePositions(page: {controls: [number,number][]}, z: number, x: number, y: number) {
  const scale = 2**(z-12);
  const step = 4/(scale*tileSize);
  const left = 4*(x%scale)/scale, top = 4*(y%scale)/scale;
  const columns = Array.from({length:tileSize},(_,col) => {
    const u = left+(col+.5)*step;
    return {offset:2*Math.floor(u), w:weights(u%1)};
  });
  const blocks = new Uint32Array(tileSize**2);
  const indices = new Uint16Array(tileSize**2);
  const keys = new Set<number>();
  for (let row=0; row<tileSize; row++) {
    const v = top+(row+.5)*step;
    const w = weights(v%1), offset = Math.floor(v)*18;
    const east = [], north = [];
    for (let i=0;i<9;i++) {
      const a=page.controls[offset+i],b=page.controls[offset+9+i],c=page.controls[offset+18+i];
      east.push(w[0]*a[0]+w[1]*b[0]+w[2]*c[0]);
      north.push(w[0]*a[1]+w[1]*b[1]+w[2]*c[1]);
    }
    for (let col=0; col<tileSize; col++) {
      const {offset:i,w:k} = columns[col];
      const e = Math.floor((k[0]*east[i]+k[1]*east[i+1]+k[2]*east[i+2])/4);
      const n = Math.floor((k[0]*north[i]+k[1]*north[i+1]+k[2]*north[i+2])/4);
      const id = Math.floor(e/cells)*4096+Math.floor(n/cells);
      const pixel = row*tileSize+col;
      blocks[pixel]=id;
      indices[pixel]=(249-n%cells)*cells+e%cells;
      keys.add(id);
    }
  }
  return {blocks,indices,keys};
}

