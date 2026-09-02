import { startStandaloneWorkBuddyServer } from '../lib/index.js'

const server = await startStandaloneWorkBuddyServer({
  port: 0,
  apiKey: 'sk-live-e2e-local-only',
})

try {
  console.log('Base URL:', server.baseUrl)

  const modelsResponse = await fetch(`${server.baseUrl}/models`, {
    headers: { authorization: `Bearer ${server.apiKey}` },
  })
  if (!modelsResponse.ok) {
    throw new Error(`models failed: ${modelsResponse.status} ${await modelsResponse.text()}`)
  }

  const models = await modelsResponse.json()
  const model = models.data.find(item => item.id === 'auto')?.id
    ?? models.data[0]?.id
  if (!model) throw new Error('no models returned')

  const nonStream = await fetch(`${server.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${server.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: '只回复：非流式成功' }],
    }),
  })
  if (!nonStream.ok) {
    throw new Error(`non-stream failed: ${nonStream.status} ${await nonStream.text()}`)
  }
  const completion = await nonStream.json()
  if (completion.object !== 'chat.completion') {
    throw new Error(`unexpected non-stream object: ${completion.object}`)
  }
  console.log('non-stream:', JSON.stringify(completion.choices?.[0]?.message?.content))

  const streaming = await fetch(`${server.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${server.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: 'user', content: '只回复：流式成功' }],
    }),
  })
  if (!streaming.ok) {
    throw new Error(`stream failed: ${streaming.status} ${await streaming.text()}`)
  }
  const text = await streaming.text()
  if (!text.includes('data: [DONE]')) throw new Error('stream did not terminate with [DONE]')
  console.log('stream: DONE received')
  console.log('LIVE STANDALONE E2E OK')
} finally {
  await server.close()
}
