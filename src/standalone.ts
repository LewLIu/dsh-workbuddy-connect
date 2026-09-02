import { WorkBuddyCredentialStore } from './auth.ts'
import { WorkBuddyCatalog } from './catalog.ts'
import { createWorkBuddyShim, type ShimLogger } from './shim.ts'
import { WorkBuddyUpstreamClient } from './upstream.ts'

export interface StandaloneWorkBuddyOptions {
  /** Defaults to the CLI's stable local port; tests may pass 0. */
  port?: number
  /** Callers provide a local proxy key; it is never forwarded upstream. */
  apiKey: string
  logger?: ShimLogger
  /** Offline test seam; production callers use the existing implementations. */
  dependencies?: {
    client?: WorkBuddyUpstreamClient
    store?: WorkBuddyCredentialStore
    catalog?: WorkBuddyCatalog
  }
}

export interface StandaloneWorkBuddyServer {
  baseUrl: string
  apiKey: string
  close(): Promise<void>
}

/** Start the standalone, loopback-only OpenAI Chat Completions endpoint. */
export async function startStandaloneWorkBuddyServer(
  options: StandaloneWorkBuddyOptions,
): Promise<StandaloneWorkBuddyServer> {
  const client = options.dependencies?.client ?? new WorkBuddyUpstreamClient()
  const store = options.dependencies?.store ?? new WorkBuddyCredentialStore({
    refresh: credential => client.refreshToken(credential),
  })
  const catalog = options.dependencies?.catalog ?? new WorkBuddyCatalog()

  const credential = await store.resolve()
  try {
    catalog.set([...(await client.fetchModels(credential))])
  } catch (error: unknown) {
    options.logger?.warn(
      'dsh-workbuddy-connect: dynamic model catalog unavailable; serving the static fallback list',
      error,
    )
  }

  const shim = createWorkBuddyShim({
    store,
    client,
    catalog,
    ...options.logger === undefined ? {} : { logger: options.logger },
    port: options.port ?? 7863,
    apiKey: options.apiKey,
    responsePolicy: 'respect-client',
  })
  await shim.ready

  return {
    baseUrl: `${shim.baseUrl()}/v1`,
    apiKey: shim.token(),
    close: () => shim.close(),
  }
}
