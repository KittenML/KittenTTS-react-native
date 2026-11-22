// The slice of ONNX Runtime's JS API the Kitten TTS 2 nano / pico / mini code uses.
// onnxruntime-react-native and onnxruntime-web both fit it, so the same code runs on
// device, on the web and in Node tests.

export interface OrtTensorLike {
  readonly data: unknown;
  readonly dims: readonly number[];
}

export interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
  release?(): Promise<void>;
}

export interface OrtLike {
  InferenceSession: {
    create(model: any, options?: any): Promise<OrtSessionLike>;
  };
  Tensor: new (type: any, data: any, dims: readonly number[]) => unknown;
}

export interface OrtSessionOptions {
  intraOpNumThreads?: number;
}

/** A session from a file path (native) or the model's bytes. */
export async function createSession(
  ort: OrtLike,
  model: string | Uint8Array,
  options: OrtSessionOptions = {},
): Promise<OrtSessionLike> {
  const sessionOptions: Record<string, unknown> = { graphOptimizationLevel: 'all' };
  if (options.intraOpNumThreads) sessionOptions.intraOpNumThreads = options.intraOpNumThreads;
  return ort.InferenceSession.create(model, sessionOptions);
}
