interface HTMLAudioElement {
  src: string;
  currentTime: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onplaying: (() => void) | null;
  pause(): void;
  play(): Promise<void>;
}

declare const Audio: {
  new(src?: string): HTMLAudioElement;
};

declare const caches: {
  open(cacheName: string): Promise<{
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
    delete(request: Request): Promise<boolean>;
  }>;
};
