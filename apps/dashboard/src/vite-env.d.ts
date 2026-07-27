/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E_AUTH?: string;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// rrweb-player ships its own types in newer versions, but the alpha used here
// is loose; declare a minimal module so the replay component typechecks.
declare module 'rrweb-player' {
  interface RRwebPlayerOptions {
    target: HTMLElement;
    props: {
      events: unknown[];
      width?: number;
      height?: number;
      autoPlay?: boolean;
      showController?: boolean;
    };
  }
  export default class RRwebPlayer {
    constructor(options: RRwebPlayerOptions);
    $destroy?: () => void;
  }
}
