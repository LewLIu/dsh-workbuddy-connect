/**
 * Aggregates OpenAI-shaped SSE for non-streaming local clients. Behavioral
 * reference: Sliverkiss/workbuddy2api/internal/upstream/sse.go (MIT).
 */

export interface OpenAIChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
      reasoning_content?: string
      tool_calls?: Array<Record<string, unknown>>
    }
    finish_reason: string | null
  }>
  usage?: unknown
}

type AggregatedToolCall = Record<string, unknown> & {
  index: number
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function mergeToolCall(target: AggregatedToolCall, delta: Record<string, unknown>): void {
  if (typeof delta['id'] === 'string' && delta['id'] !== '') target.id = delta['id']
  if (typeof delta['type'] === 'string' && delta['type'] !== '') target.type = delta['type']

  const fn = recordOf(delta['function'])
  if (fn === undefined) return

  target.function ??= {}
  if (typeof fn['name'] === 'string' && fn['name'] !== '') target.function.name = fn['name']
  if (typeof fn['arguments'] === 'string' && fn['arguments'] !== '') {
    target.function.arguments = (target.function.arguments ?? '') + fn['arguments']
  }
}

/** Aggregate one upstream SSE response into an OpenAI chat completion. */
export async function aggregateChatCompletionSse(
  body: ReadableStream<Uint8Array>,
  fallbackModel: string,
): Promise<OpenAIChatCompletion> {
  let id = ''
  let model = ''
  let created = 0
  let sawCreated = false
  let role = 'assistant'
  let finishReason: string | null = null
  let content = ''
  let reasoning = ''
  let usage: unknown
  let hasUsage = false
  let validEvents = 0
  let sawDone = false
  const toolCalls = new Map<number, AggregatedToolCall>()

  function consumeJsonEvent(payload: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    validEvents += 1
    const event = recordOf(parsed)
    if (event === undefined) return

    if (id === '' && typeof event['id'] === 'string' && event['id'] !== '') id = event['id']
    if (model === '' && typeof event['model'] === 'string' && event['model'] !== '') model = event['model']
    if (!sawCreated && typeof event['created'] === 'number' && Number.isFinite(event['created'])) {
      created = event['created']
      sawCreated = true
    }
    if ('usage' in event) {
      usage = event['usage']
      hasUsage = true
    }

    const choices = event['choices']
    if (!Array.isArray(choices)) return
    for (const rawChoice of choices) {
      const choice = recordOf(rawChoice)
      if (choice === undefined || choice['index'] !== 0) continue
      const delta = recordOf(choice['delta'])
      if (delta !== undefined) {
        if (typeof delta['role'] === 'string' && delta['role'] !== '') role = delta['role']
        if (typeof delta['content'] === 'string') content += delta['content']
        if (typeof delta['reasoning_content'] === 'string') reasoning += delta['reasoning_content']
        const calls = delta['tool_calls']
        if (Array.isArray(calls)) {
          for (const rawCall of calls) {
            const call = recordOf(rawCall)
            if (call === undefined) continue
            const index = call['index']
            if (typeof index !== 'number' || !Number.isInteger(index)) continue
            let target = toolCalls.get(index)
            if (target === undefined) {
              target = { index }
              toolCalls.set(index, target)
            }
            mergeToolCall(target, call)
          }
        }
      }
      if (typeof choice['finish_reason'] === 'string' && choice['finish_reason'] !== '') {
        finishReason = choice['finish_reason']
      }
    }
  }

  function consumeLine(rawLine: string): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trimStart()
    if (payload === '[DONE]') {
      sawDone = true
      return
    }
    consumeJsonEvent(payload)
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let carry = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      carry += decoder.decode(value, { stream: !done })

      let newline = carry.indexOf('\n')
      while (newline !== -1) {
        consumeLine(carry.slice(0, newline))
        carry = carry.slice(newline + 1)
        if (sawDone) break
        newline = carry.indexOf('\n')
      }

      if (sawDone || done) break
    }
    if (!sawDone && carry !== '') consumeLine(carry)
  } finally {
    reader.releaseLock()
  }

  if (validEvents === 0) throw new Error('workbuddy upstream SSE contained no valid data events')

  const message: OpenAIChatCompletion['choices'][number]['message'] = { role, content }
  if (reasoning !== '') message.reasoning_content = reasoning
  if (toolCalls.size > 0) message.tool_calls = [...toolCalls.values()].sort((left, right) => left.index - right.index)

  const completion: OpenAIChatCompletion = {
    id: id === '' ? `chatcmpl-workbuddy-${Date.now()}` : id,
    object: 'chat.completion',
    created: sawCreated ? created : Math.floor(Date.now() / 1000),
    model: model === '' ? fallbackModel : model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
  }
  if (hasUsage) completion.usage = usage
  return completion
}
