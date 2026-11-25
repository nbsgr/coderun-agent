import { InferenceSession, OnnxValue, TensorConstructor } from 'onnxruntime-common';
type SessionOptions = InferenceSession.SessionOptions;
type FeedsType = {
    [name: string]: OnnxValue;
};
type FetchesType = {
    [name: string]: OnnxValue | null;
};
type ReturnType = {
    [name: string]: OnnxValue;
};
type RunOptions = InferenceSession.RunOptions;
/**
 * Binding exports a simple inference session object wrap.
 *
 * `loadModel()` returns a Promise. A session that registers a synchronous JavaScript callback is
 * constructed on a worker thread so that the event loop remains available to service that callback.
 */
export declare namespace Binding {
    interface ValueMetadata {
        name: string;
        isTensor: boolean;
        symbolicDimensions: string[];
        shape: number[];
        type: number;
    }
    interface InferenceSession {
        loadModel(modelPath: string, options: SessionOptions): Promise<void>;
        loadModel(buffer: ArrayBuffer, byteOffset: number, byteLength: number, options: SessionOptions): Promise<void>;
        readonly inputMetadata: ValueMetadata[];
        readonly outputMetadata: ValueMetadata[];
        run(feeds: FeedsType, fetches: FetchesType, options: RunOptions): ReturnType;
        endProfiling(): void;
        dispose(): void;
    }
    interface InferenceSessionConstructor {
        new (): InferenceSession;
    }
    interface SupportedBackend {
        name: string;
        bundled: boolean;
    }
}
export declare const binding: {
    InferenceSession: Binding.InferenceSessionConstructor;
    listSupportedBackends: () => Binding.SupportedBackend[];
    initOrtOnce: (logLevel: number, tensorConstructor: TensorConstructor, isMainThread: boolean) => void;
    /** @internal Native callback bridge used by binding tests, not a supported API. */
    __testEpContextDataReadCallback: (callback: (name: string) => unknown, maxDataSize: number, name: string) => Promise<Buffer>;
};
export declare const initOrt: () => void;
export {};
