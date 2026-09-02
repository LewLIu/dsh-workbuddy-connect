import { describe, expect, it } from 'vitest'
import { WorkBuddyCredentialStore } from '../src/auth.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { startStandaloneWorkBuddyServer } from '../src/standalone.ts'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'

describe('startStandaloneWorkBuddyServer', () => {
  it('fails before listening when no WorkBuddy desktop-backed credential is available', async () => {
    const store = {
      async resolve() {
        throw new Error('workbuddy: no signed-in WorkBuddy account found; sign in once in the WorkBuddy desktop app')
      },
    } as unknown as WorkBuddyCredentialStore

    await expect(startStandaloneWorkBuddyServer({
      port: 0,
      apiKey: 'sk-test',
      dependencies: {
        store,
        client: {} as WorkBuddyUpstreamClient,
        catalog: new WorkBuddyCatalog(),
      },
    })).rejects.toThrow('sign in once in the WorkBuddy desktop app')
  })

  it('starts a loopback OpenAI BaseURL after refreshing the catalog', async () => {
    const credential = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAtMs: Date.now() + 60_000,
      domain: 'www.codebuddy.cn',
      uid: 'u1',
      source: 'desktop',
    } as const
    const store = {
      async resolve() { return credential },
    } as unknown as WorkBuddyCredentialStore
    const client = {
      async fetchModels() {
        return [{
          id: 'live-model',
          name: 'Live Model',
          contextWindow: 1000,
          maxTokens: 100,
          supportsImages: false,
        }]
      },
      async chatStream() {
        return {
          ok: true,
          response: new Response('data: [DONE]\n\n', {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        } as const
      },
    } as unknown as WorkBuddyUpstreamClient

    const server = await startStandaloneWorkBuddyServer({
      port: 0,
      apiKey: 'sk-test',
      dependencies: { store, client, catalog: new WorkBuddyCatalog() },
    })
    try {
      expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
      const models = await fetch(`${server.baseUrl}/models`, {
        headers: { authorization: 'Bearer sk-test' },
      })
      expect(models.status).toBe(200)
      expect(await models.json()).toMatchObject({ data: [{ id: 'live-model' }] })
    } finally {
      await server.close()
    }
  })

  it('keeps the fallback catalog when startup discovery fails', async () => {
    const credential = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAtMs: Date.now() + 60_000,
      domain: 'www.codebuddy.cn',
      uid: 'u1',
      source: 'desktop',
    } as const
    const store = {
      async resolve() { return credential },
    } as unknown as WorkBuddyCredentialStore
    const client = {
      async fetchModels() {
        throw new Error('catalog offline')
      },
      async chatStream() {
        return {
          ok: true,
          response: new Response('data: [DONE]\n\n', {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        } as const
      },
    } as unknown as WorkBuddyUpstreamClient
    const warnings: unknown[][] = []
    const server = await startStandaloneWorkBuddyServer({
      port: 0,
      apiKey: 'sk-test',
      logger: { warn: (...args) => warnings.push(args), error: () => undefined },
      dependencies: { store, client, catalog: new WorkBuddyCatalog() },
    })
    try {
      expect(warnings).toHaveLength(1)
      const models = await fetch(`${server.baseUrl}/models`, {
        headers: { authorization: 'Bearer sk-test' },
      })
      const body = await models.json() as { data: Array<{ id: string }> }
      expect(body.data.map(model => model.id)).toContain('auto')
    } finally {
      await server.close()
    }
  })
})
