declare module 'bs58' {
  const bs58: {
    encode(bytes: Uint8Array | number[]): string;
    decode(str: string): Uint8Array;
  };
  export default bs58;
}
