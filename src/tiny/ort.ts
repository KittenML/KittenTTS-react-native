// The slice of ONNX Runtime's JS API the Kitten TTS 2 nano / pico / mini code uses.
// onnxruntime-react-native and onnxruntime-web both fit it, so the same code runs on
// device, on the web and in Node tests.

export interface OrtSessionLike {
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { readonly data: unknown }>>;
  release?(): Promise<void>;
}

export interface OrtLike {
  InferenceSession: {
    create(model: any, options?: any): Promise<OrtSessionLike>;
  };
  Tensor: new (type: any, data: any, dims: readonly number[]) => unknown;
}

/** A session from a file path (native) or the model's bytes. */
export function createSession(ort: OrtLike, model: string | Uint8Array, threads?: number): Promise<OrtSessionLike> {
  return ort.InferenceSession.create(model, {
    graphOptimizationLevel: 'all',
    ...(threads ? { intraOpNumThreads: threads } : {}),
  });
}
