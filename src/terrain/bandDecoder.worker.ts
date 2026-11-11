import {inflateBytes} from './bandDecoder';

self.onmessage = async ({data}: MessageEvent<{bytes:Uint8Array<ArrayBuffer>;size:number}>) => {
  try {
    const result = await inflateBytes(data.bytes,data.size);
    self.postMessage(result, {transfer: [result]});
  } catch (error) {
    self.postMessage({error: String(error)});
  }
};
