declare module '@opencode-ai/plugin' {
  export interface PluginInput {
    client: unknown;
    project: unknown;
    directory: string;
    worktree: string;
    serverUrl: string;
    $: unknown;
  }

  export interface Provider {
    id?: string;
    name?: string;
    api?: string;
    npm?: string;
    env?: string[];
    options?: Record<string, unknown>;
    models?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface Config {
    provider?: Record<string, Provider>;
    plugin?: Array<string | [string, Record<string, unknown>]>;
    [key: string]: unknown;
  }

  export type AuthApi = {
    type: 'api';
    key: string;
  };

  export type AuthOauth = {
    type: 'oauth';
    refresh: string;
    access: string;
    expires: number;
    accountId?: string;
    enterpriseUrl?: string;
  };

  export type AuthWellKnown = {
    type: 'wellknown';
    key: string;
    token: string;
  };

  export type Auth = AuthApi | AuthOauth | AuthWellKnown;

  export type ApiAuthorizeResult =
    | {
        type: 'success';
        key: string;
        provider?: string;
      }
    | {
        type: 'failed';
      };

  export interface ApiMethod {
    type: 'api';
    label: string;
    prompts?: Prompt[];
    authorize?: (inputs?: Record<string, string>) => Promise<ApiAuthorizeResult>;
  }

  export interface OAuthMethod {
    type: 'oauth';
    label: string;
    auth: (provider: Provider, state: string) => Promise<string>;
    callback: (input: {
      code: string;
      provider: Provider;
      server: string;
      codeVerifier: string;
    }) => Promise<AuthOauth>;
  }

  export type AuthMethod = ApiMethod | OAuthMethod;

  export type Prompt = {
    type: 'text';
    key: string;
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | undefined;
    condition?: (value: Record<string, string>) => boolean;
  };

  export interface AuthHook {
    provider: string;
    loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, unknown>>;
    methods: AuthMethod[];
  }

  export interface ProviderHookContext {
    auth?: Auth;
  }

  /** Matches opencode.ai/config.json ProviderConfig.models.* */
  export interface ModelV2 {
    id: string;
    name: string;
    family: string;
    release_date: string;
    attachment?: boolean;
    reasoning?: boolean;
    temperature?: boolean;
    tool_call?: boolean;
    modalities?: {
      input: readonly string[];
      output: readonly string[];
    };
    cost: {
      input: number;
      output: number;
      cache_read?: number;
      cache_write?: number;
    };
    limit: { context: number; output: number };
    options?: Record<string, unknown>;
    headers?: Record<string, string>;
    status?: 'alpha' | 'beta' | 'deprecated' | 'active';
    variants?: Record<string, { disabled?: boolean; reasoningEffort?: string }>;
  }

  export interface ProviderV2 {
    id: string;
    name: string;
    source: string;
    env: string[];
    key?: string;
    options: Record<string, unknown>;
    models: Record<string, ModelV2>;
  }

  export interface ProviderHook {
    id: string;
    models?: (
      provider: ProviderV2,
      ctx: ProviderHookContext,
    ) => Promise<Record<string, ModelV2>>;
  }

  export interface Hooks {
    config?: (input: Config) => Promise<void>;
    auth?: AuthHook;
    provider?: ProviderHook;
    [key: string]: unknown;
  }

  export type Plugin = (
    input: PluginInput,
    options?: Record<string, unknown>,
  ) => Promise<Hooks>;
}