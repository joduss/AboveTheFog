import {readExact} from './transfer';

export async function inflateBytes(bytes: Uint8Array<ArrayBuffer>, size: number) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return readExact(stream,size);
}
