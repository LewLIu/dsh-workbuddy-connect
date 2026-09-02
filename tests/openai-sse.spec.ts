import { describe, expect, it } from 'vitest'
import { aggregateChatCompletionSse } from '../src/openai-sse.ts'

function byteStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('aggregateChatCompletionSse', () => {
  it('aggregates content across arbitrary transport chunk boundaries', async () => {
    const result = await aggregateChatCompletionSse(byteStream([
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":123,"model":"auto","choices":[{"index":0,"delta":{"role":"assistant","content":"你"},"finish_reason":null}]}\n',
      '\ndata: {"choices":[{"index":0,"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
      'data: [DO',
      'NE]\n\n',
    ]), 'fallback-model')

    expect(result).toEqual({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 123,
      model: 'auto',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: '你好' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    })
  })

  it('aggregates reasoning_content and tool-call argument fragments by index', async () => {
    const result = await aggregateChatCompletionSse(byteStream([
      'data: {"choices":[{"index":0,"delta":{"reasoning_content":"先想","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"weather","arguments":"{\\"city\\":"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"reasoning_content":"一下","tool_calls":[{"index":0,"function":{"arguments":"\\"Melbourne\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]), 'auto')

    expect(result.choices[0]?.message.reasoning_content).toBe('先想一下')
    expect(result.choices[0]?.message.tool_calls).toEqual([{
      index: 0,
      id: 'call_1',
      type: 'function',
      function: {
        name: 'weather',
        arguments: '{"city":"Melbourne"}',
      },
    }])
    expect(result.choices[0]?.finish_reason).toBe('tool_calls')
  })

  it('rejects a stream with no valid JSON data events', async () => {
    await expect(aggregateChatCompletionSse(
      byteStream([': keepalive\n\n', 'data: [DONE]\n\n']),
      'auto',
    )).rejects.toThrow('no valid data events')
  })

  it('uses safe metadata fallbacks when upstream omits them', async () => {
    const before = Math.floor(Date.now() / 1000)
    const result = await aggregateChatCompletionSse(byteStream([
      'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]), 'deepseek-v4-flash')
    const after = Math.floor(Date.now() / 1000)

    expect(result.id).toMatch(/^chatcmpl-workbuddy-\d+$/)
    expect(result.model).toBe('deepseek-v4-flash')
    expect(result.created).toBeGreaterThanOrEqual(before)
    expect(result.created).toBeLessThanOrEqual(after)
  })
})
