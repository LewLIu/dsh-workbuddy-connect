//#region src/bin.d.ts
/** Standalone status/diagnostics CLI for the dsh-workbuddy-connect bundle. */
declare const WORKBUDDY_PROXY_API_KEY_ENV = "WORKBUDDY_PROXY_API_KEY";
interface ServeCliOptions {
  port: number;
  apiKey?: string;
}
interface ResolvedProxyKey {
  value: string;
  source: 'flag' | 'env' | 'generated';
}
declare function parseServeCliOptions(flags: readonly string[]): ServeCliOptions;
declare function resolveProxyApiKey(explicit: string | undefined, env: NodeJS.ProcessEnv): ResolvedProxyKey;
/** Execute one boot-free command. */
declare function run(argv: readonly string[]): Promise<number>;
//#endregion
export { ResolvedProxyKey, ServeCliOptions, WORKBUDDY_PROXY_API_KEY_ENV, parseServeCliOptions, resolveProxyApiKey, run };