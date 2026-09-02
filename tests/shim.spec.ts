import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyCredentialStore } from '../src/auth.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { createWorkBuddyShim, type WorkBuddyShim, type WorkBuddyShimOptions } from '../src/shim.ts'
import type { WorkBuddyChatResult } from '../src/upstream.ts'

const CLEANUP: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(CLEANUP.splice(0).map(clean => clean()))
})

interface Harness {
  shim: WorkBuddyShim
  store: WorkBuddyCredentialStore
  upstreamBodies: string[]
  upstreamResponse: () => WorkBuddyChatResult
}

/** Raw HTTP request with full header control (fetch forbids overriding Host). */
function rawRequest(options: {
  port: number
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: options.port,
      method: options.method,
      path: options.path,
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

async function startShim(
  upstreamResponse: () => WorkBuddyChatResult,
  shimOptions: Partial<Pick<WorkBuddyShimOptions, 'port' | 'apiKey' | 'responsePolicy'>> = {},
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-shim-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  const desktop = join(dir, 'workbuddy-desktop.info')
  await writeFile(desktop, JSON.stringify({
    auth: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, domain: 'www.codebuddy.cn' },
    account: { uid: 'uid-1' },
  }))
  const store = new WorkBuddyCredentialStore({
    desktopPath: desktop,
    ownPath: join(dir, 'own.json'),
    refresh: async () => ({ accessToken: 'unused' }),
  })
  const harness: Harness = {
    shim: undefined as unknown as WorkBuddyShim,
    store,
    upstreamBodies: [],
    upstreamResponse,
  }
  harness.shim = createWorkBuddyShim({
    store,
    catalog: new WorkBuddyCatalog(),
    client: {
      async chatStream(_credential, bodyJson): Promise<WorkBuddyChatResult> {
        harness.upstreamBodies.push(bodyJson)
        return harness.upstreamResponse()
      },
    },
    ...shimOptions,
  })
  await harness.shim.ready
  CLEANUP.push(() => harness.shim.close())
  return harness
}

describe('WorkBuddy shim', () => {
  it('uses an explicit standalone bearer when configured', async () => {
    const harness = await startShim(
      () => ({ ok: false, status: 500, kind: 'server', message: 'unused' }),
      { apiKey: 'sk-explicit-test' },
    )

    expect(harness.shim.token()).toBe('sk-explicit-test')

    const response = await fetch(`${harness.shim.baseUrl()}/healthz`, {
      headers: { authorization: 'Bearer sk-explicit-test' },
    })
    expect(response.status).toBe(200)
  })

  it('keeps an ephemeral port by default', async () => {
    const harness = await startShim(
      () => ({ ok: false, status: 500, kind: 'server', message: 'unused' }),
    )
    expect(Number(new URL(harness.shim.baseUrl()).port)).toBeGreaterThan(0)
  })

  it('lists the catalog on /v1/models', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/models`, {
      headers: { authorization: `Bearer ${harness.shim.token()}` },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { id: string }[] }
    const ids = body.data.map(model => model.id)
    expect(ids).toContain('auto')
    expect(ids).toContain('deepseek-v4-pro')
    expect(ids.length).toBe(11)
  })

  it('force-stream remains the default even when the request says stream false', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({
        model: 'auto',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        tool_choice: { type: 'auto' },
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('你好')
    expect(text).toContain('[DONE]')
    expect(harness.upstreamBodies.length).toBe(1)
    const forwarded = JSON.parse(harness.upstreamBodies[0] ?? '') as Record<string, unknown>
    expect(forwarded['stream']).toBe(true)
    expect(forwarded['tool_choice']).toBe('auto')
  })

  it('respect-client returns JSON when stream is false', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response(
        'data: {"id":"chatcmpl-1","created":123,"model":"auto","choices":[{"index":0,"delta":{"role":"assistant","content":"你"},"finish_reason":null}]}\n\n'
        + 'data: {"choices":[{"index":0,"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"total_tokens":3}}\n\n'
        + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    }), { responsePolicy: 'respect-client' })
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'auto', stream: false, messages: [{ role: 'user', content: 'hi' }] }),
    })

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({
      object: 'chat.completion',
      model: 'auto',
      choices: [{
        message: { role: 'assistant', content: '你好' },
        finish_reason: 'stop',
      }],
    })
  })

  it('respect-client treats omitted stream as false', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response(
        'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'
        + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    }), { responsePolicy: 'respect-client' })
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] }),
    })

    expect(response.headers.get('content-type')).toContain('application/json')
    expect((await response.json() as { object: string }).object).toBe('chat.completion')
  })

  it('respect-client still streams when stream is true', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    }), { responsePolicy: 'respect-client' })
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'auto', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(await response.text()).toContain('[DONE]')
  })

  it('respect-client merges reasoning and tool-call fragments into JSON', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response(
        'data: {"choices":[{"index":0,"delta":{"reasoning_content":"先想","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"weather","arguments":"{\\"city\\":"}}]},"finish_reason":null}]}\n\n'
        + 'data: {"choices":[{"index":0,"delta":{"reasoning_content":"一下","tool_calls":[{"index":0,"function":{"arguments":"\\"Melbourne\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
        + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    }), { responsePolicy: 'respect-client' })
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] }),
    })

    expect(await response.json()).toMatchObject({
      choices: [{
        message: {
          reasoning_content: '先想一下',
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Melbourne"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    })
  })

  it('maps invalid upstream SSE to an OpenAI 502 error in respect-client mode', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response('data: not-json\n\ndata: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    }), { responsePolicy: 'respect-client' })
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] }),
    })

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { type: 'upstream_parse' } })
  })

  it('maps an upstream credit failure onto HTTP 402', async () => {
    const harness = await startShim(() => ({
      ok: false,
      status: 402,
      kind: 'hard_credit',
      message: '积分不足',
    }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'auto', messages: [] }),
    })
    expect(response.status).toBe(402)
    const body = await response.json() as { error: { type: string, message: string } }
    expect(body.error.type).toBe('hard_credit')
    expect(body.error.message).toContain('积分不足')
  })

  it('answers unknown routes with 404', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/nothing`, {
      headers: { authorization: `Bearer ${harness.shim.token()}` },
    })
    expect(response.status).toBe(404)
  })

  it('binds loopback only', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    expect(harness.shim.baseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('rejects a non-loopback Host header (DNS rebinding)', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    // A rebinding page resolves evil.com to 127.0.0.1; the browser then sends
    // Host: evil.com:<port>. fetch() forbids overriding Host, so use raw http.
    const res = await rawRequest({
      port,
      method: 'GET',
      path: '/healthz',
      headers: { host: 'evil.com' },
    })
    expect(res.status).toBe(403)
    expect(res.body).toContain('host_not_allowed')
  })

  it('accepts Host with a loopback name plus port', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'GET',
      path: '/healthz',
      headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${harness.shim.token()}` },
    })
    expect(res.status).toBe(200)
  })

  it('rejects a browser Origin from a non-loopback site', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        origin: 'https://evil.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'auto', messages: [] }),
    })
    expect(res.status).toBe(403)
    expect(res.body).toContain('origin_not_allowed')
    // Nothing reached the upstream.
    expect(harness.upstreamBodies).toHaveLength(0)
  })

  it('accepts a loopback browser Origin', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response('data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        origin: 'http://127.0.0.1:3080',
        'content-type': 'application/json',
        authorization: `Bearer ${harness.shim.token()}`,
      },
      body: JSON.stringify({ model: 'auto', messages: [] }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects a chat POST with a non-JSON Content-Type (simple-request CSRF)', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'text/plain',
        authorization: `Bearer ${harness.shim.token()}`,
      },
      body: JSON.stringify({ model: 'auto', messages: [] }),
    })
    expect(res.status).toBe(415)
    expect(res.body).toContain('unsupported_media_type')
    // Nothing reached the upstream.
    expect(harness.upstreamBodies).toHaveLength(0)
  })

  it('rejects a loopback request without a bearer (local process without the secret)', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    // Everything else about this request is legitimate: loopback Host, no
    // Origin (a local process, not a browser), JSON body. Only the bearer is
    // missing — this is the shape a hostile local process would send.
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'auto', messages: [] }),
    })
    expect(res.status).toBe(401)
    expect(res.body).toContain('unauthorized')
    expect(harness.upstreamBodies).toHaveLength(0)
  })

  it('rejects a loopback request with a wrong bearer', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
        authorization: 'Bearer not-the-real-secret',
      },
      body: JSON.stringify({ model: 'auto', messages: [] }),
    })
    expect(res.status).toBe(401)
    expect(harness.upstreamBodies).toHaveLength(0)
  })
})
