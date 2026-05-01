declare module "exif-parser" {
  type ExifTags = Record<string, unknown>;
  interface ExifResult {
    tags?: ExifTags;
    imageSize?: { width?: number; height?: number };
    thumbnailOffset?: number;
    thumbnailLength?: number;
    thumbnailType?: number;
    app1Offset?: number;
  }
  interface ExifParserInstance {
    parse(): ExifResult;
    enableBinaryFields(enabled: boolean): ExifParserInstance;
    enableTagNames(enabled: boolean): ExifParserInstance;
    enableImageSize(enabled: boolean): ExifParserInstance;
    enableReturnTags(enabled: boolean): ExifParserInstance;
    enableSimpleValues(enabled: boolean): ExifParserInstance;
  }
  const ExifParser: {
    create(buffer: Buffer | Uint8Array): ExifParserInstance;
  };
  export default ExifParser;
}
