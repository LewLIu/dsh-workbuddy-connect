import { describe, expect, it, vi } from 'vitest'
import { parseServeCliOptions, resolveProxyApiKey, run } from '../src/bin.ts'

describe('serve CLI parsing', () => {
  it('defaults to port 7863', () => {
    expect(parseServeCliOptions([])).toEqual({ port: 7863 })
  })

  it('accepts port and api key', () => {
    expect(parseServeCliOptions([
      '--port', '9000',
      '--api-key', 'sk-test',
    ])).toEqual({
      port: 9000,
      apiKey: 'sk-test',
    })
  })

  for (const port of ['0', '65536', '-1', 'abc', '7863.5']) {
    it(`rejects invalid port ${port}`, () => {
      expect(() => parseServeCliOptions(['--port', port])).toThrow('port')
    })
  }

  it('rejects a missing api-key value', () => {
    expect(() => parseServeCliOptions(['--api-key'])).toThrow('api-key')
  })

  it('rejects a blank api-key value', () => {
    expect(() => parseServeCliOptions(['--api-key', '  '])).toThrow('api-key')
  })

  it('rejects unknown flags', () => {
    expect(() => parseServeCliOptions(['--host', '0.0.0.0'])).toThrow('--host')
  })
})

describe('proxy API key resolution', () => {
  it('prefers flag over environment', () => {
    expect(resolveProxyApiKey('from-flag', {
      WORKBUDDY_PROXY_API_KEY: 'from-env',
    })).toEqual({ value: 'from-flag', source: 'flag' })
  })

  it('uses environment when no flag exists', () => {
    expect(resolveProxyApiKey(undefined, {
      WORKBUDDY_PROXY_API_KEY: 'from-env',
    })).toEqual({ value: 'from-env', source: 'env' })
  })

  it('generates a non-empty secret when neither is configured', () => {
    const result = resolveProxyApiKey(undefined, {})
    expect(result.source).toBe('generated')
    expect(result.value.length).toBeGreaterThanOrEqual(32)
  })
})

describe('serve CLI dispatch', () => {
  it('rejects --json before attempting to start the server', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      await expect(run(['serve', '--json'])).resolves.toBe(1)
      expect(write).toHaveBeenCalledWith('dsh-workbuddy-connect: invalid options for serve: --json\n')
    } finally {
      write.mockRestore()
    }
  })
})
