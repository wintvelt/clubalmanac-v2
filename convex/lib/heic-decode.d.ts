declare module "heic-decode" {
  type Decoded = { width: number; height: number; data: Uint8ClampedArray };
  function decode(options: { buffer: Uint8Array | ArrayBuffer }): Promise<Decoded>;
  export default decode;
}
