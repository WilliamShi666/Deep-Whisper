import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEEPSEEK_VISION_MODEL,
  DeepSeekChatProvider,
} from '../src/lib/ai/providers/deepseek-chat-provider';

// 断言跟随单一事实来源，避免供应商下一次静默改名又把这层测试打红。
const MODEL = DEEPSEEK_VISION_MODEL;
const LEGACY_ALIAS_MODEL = 'deepseek-v4-flash-vision-exp';

function asFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}

function providerWith(
  fetchImpl: typeof fetch,
  env: Record<string, string> = {},
): DeepSeekChatProvider {
  return new DeepSeekChatProvider({
    model: MODEL,
    fetchImpl,
    env: {
      DEEPSEEK_API_KEY: 'contract-test-key',
      DEEPSEEK_BASE_URL: 'https://deepseek.test/v1/',
      ...env,
    },
  });
}

test('DeepSeek completion uses the official chat shape and always disables thinking', async () => {
  let requestUrl = '';
  let requestBody: Record<string, unknown> | undefined;
  const provider = providerWith(
    asFetch(async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: 'deepseek-request-1',
        model: MODEL,
        choices: [{ finish_reason: 'stop', message: { content: '晚安' } }],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      });
    }),
  );

  const result = await provider.complete({
    messages: [{ role: 'user', content: '晚安' }],
    temperature: 0.2,
    maxAttempts: 1,
  });

  assert.equal(requestUrl, 'https://deepseek.test/v1/chat/completions');
  assert.equal(requestBody?.model, MODEL);
  assert.equal(requestBody?.stream, false);
  assert.deepEqual(requestBody?.thinking, { type: 'disabled' });
  assert.deepEqual(requestBody?.messages, [{ role: 'user', content: '晚安' }]);
  assert.equal(result.content, '晚安');
  assert.equal(result.providerRequestId, 'deepseek-request-1');
  assert.deepEqual(result.usage, {
    inputTokens: 8,
    outputTokens: 2,
    totalTokens: 10,
  });
});


// 2026-09-27：思考模式变成按请求显式开启（缺省仍关）。整理器要开 low，其余一律关——
// 供应商侧默认 effort 是 high，所以开启时必须显式带上 reasoning_effort。
test('thinking is off by default and can be enabled per request with an explicit effort', async () => {
  let enabledBody: Record<string, unknown> | undefined;
  const enabled = providerWith(
    asFetch(async (_input, init) => {
      enabledBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: 'deepseek-request-thinking',
        model: MODEL,
        choices: [{ finish_reason: 'stop', message: { content: '{"operations":[]}' } }],
      });
    }),
  );

  await enabled.complete({
    messages: [{ role: 'user', content: '整理这轮对话' }],
    thinking: 'enabled',
    reasoningEffort: 'low',
    maxAttempts: 1,
  });

  assert.deepEqual(enabledBody?.thinking, { type: 'enabled' });
  assert.equal(enabledBody?.reasoning_effort, 'low');
  // 思考模式下 temperature 不生效，索性不发，避免"看起来设了其实没生效"。
  assert.equal('temperature' in (enabledBody ?? {}), false);

  let disabledBody: Record<string, unknown> | undefined;
  const disabled = providerWith(
    asFetch(async (_input, init) => {
      disabledBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: 'deepseek-request-plain',
        model: MODEL,
        choices: [{ finish_reason: 'stop', message: { content: '晚安' } }],
      });
    }),
  );

  await disabled.complete({
    messages: [{ role: 'user', content: '晚安' }],
    temperature: 0.85,
    maxAttempts: 1,
  });

  assert.deepEqual(disabledBody?.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in (disabledBody ?? {}), false);
  assert.equal(disabledBody?.temperature, 0.85);
});

test('DeepSeek preserves multimodal image parts and parses structured JSON through the caller parser', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = providerWith(
    asFetch(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: 'deepseek-request-2',
        model: MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '{"safe":false,"reasonCode":"policy"}' },
          },
        ],
      });
    }),
  );

  const result = await provider.completeStructured({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '检查图片' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,AQID',
              detail: 'low',
            },
          },
        ],
      },
    ],
    temperature: 0,
    maxAttempts: 1,
    outputSchema: {
      name: 'vision_safety_result',
      strict: true,
      schema: {
        type: 'object',
        required: ['safe'],
        properties: { safe: { type: 'boolean' } },
      },
    },
    parse(value) {
      const candidate = value as { safe?: unknown; reasonCode?: unknown };
      if (typeof candidate.safe !== 'boolean') throw new Error('invalid safe');
      return {
        safe: candidate.safe,
        reasonCode:
          typeof candidate.reasonCode === 'string'
            ? candidate.reasonCode
            : undefined,
      };
    },
  });

  assert.deepEqual(requestBody?.thinking, { type: 'disabled' });
  assert.deepEqual(requestBody?.response_format, { type: 'json_object' });
  const messages = requestBody?.messages as Array<Record<string, unknown>>;
  assert.equal(messages.at(-1)?.role, 'user');
  assert.deepEqual(
    (messages.at(-1)?.content as Array<Record<string, unknown>>).at(-1),
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AQID', detail: 'low' },
    },
  );
  assert.deepEqual(result.data, { safe: false, reasonCode: 'policy' });
});

test('DeepSeek rejects malformed structured JSON', async () => {
  const provider = providerWith(
    asFetch(async () =>
      Response.json({
        model: MODEL,
        choices: [{ message: { content: 'not-json' } }],
      }),
    ),
  );

  await assert.rejects(
    provider.completeStructured({
      messages: [{ role: 'user', content: 'return json' }],
      maxAttempts: 1,
      outputSchema: { name: 'result', schema: { type: 'object' } },
      parse: (value) => value,
    }),
    /malformed structured JSON/,
  );
});

test('DeepSeek stream handles split SSE frames and yields only visible text', async () => {
  const encoder = new TextEncoder();
  const frames = [
    'data: {"choices":[{"delta":{"content":"你"}}]}\n',
    '\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const provider = providerWith(
    asFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.stream, true);
      assert.deepEqual(body.thinking, { type: 'disabled' });
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const frame of frames) controller.enqueue(encoder.encode(frame));
            controller.close();
          },
        }),
      );
    }),
  );

  const chunks: string[] = [];
  for await (const chunk of provider.stream({
    messages: [{ role: 'user', content: '你好' }],
    maxAttempts: 1,
  })) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ['你', '好']);
});

test('DeepSeek retries 429 but never retries 401', async () => {
  let retryableAttempts = 0;
  const retryingProvider = providerWith(
    asFetch(async () => {
      retryableAttempts += 1;
      if (retryableAttempts === 1) return new Response(null, { status: 429 });
      return Response.json({
        model: MODEL,
        choices: [{ message: { content: 'ok' } }],
      });
    }),
  );
  await retryingProvider.complete({
    messages: [{ role: 'user', content: 'retry' }],
    maxAttempts: 2,
  });
  assert.equal(retryableAttempts, 2);

  let unauthorizedAttempts = 0;
  const unauthorizedProvider = providerWith(
    asFetch(async () => {
      unauthorizedAttempts += 1;
      return Response.json(
        { error: { message: 'contract-test-key rejected' } },
        { status: 401 },
      );
    }),
  );
  await assert.rejects(
    unauthorizedProvider.complete({
      messages: [{ role: 'user', content: 'do not leak me' }],
      maxAttempts: 3,
    }),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message.includes('contract-test-key'), false);
      assert.equal(error.message.includes('do not leak me'), false);
      assert.match(error.message, /HTTP 401/);
      return true;
    },
  );
  assert.equal(unauthorizedAttempts, 1);
});

test('DeepSeek rejects malformed model IDs before a request', () => {
  assert.throws(
    () =>
      new DeepSeekChatProvider({
        model: 'invalid model',
        fetchImpl: asFetch(async () => new Response()),
        env: { DEEPSEEK_API_KEY: 'contract-test-key' },
      }),
    /model ID/,
  );
});

// 回归守卫：供应商把别名请求的响应 model 规范化成正式名之后，
// 旧的严格相等比较会直接抛错，整条对话失败（用户看到的「发不了消息」）。
test('DeepSeek accepts its canonical model name echoed back for a legacy alias request', async () => {
  const provider = new DeepSeekChatProvider({
    model: LEGACY_ALIAS_MODEL,
    fetchImpl: asFetch(async () =>
      Response.json({
        id: 'deepseek-request-rename',
        model: DEEPSEEK_VISION_MODEL,
        choices: [{ finish_reason: 'stop', message: { content: '在的' } }],
      }),
    ),
    env: {
      DEEPSEEK_API_KEY: 'contract-test-key',
      DEEPSEEK_BASE_URL: 'https://deepseek.test/v1/',
    },
  });

  const result = await provider.complete({
    messages: [{ role: 'user', content: '在吗' }],
    temperature: 0.2,
    maxAttempts: 1,
  });

  assert.equal(result.content, '在的');
});

test('DeepSeek still fails loudly when the response reports an unrelated model', async () => {
  const provider = providerWith(
    asFetch(async () =>
      Response.json({
        id: 'deepseek-request-unexpected',
        model: 'deepseek-v4-pro',
        choices: [{ finish_reason: 'stop', message: { content: '在的' } }],
      }),
    ),
  );

  await assert.rejects(
    () =>
      provider.complete({
        messages: [{ role: 'user', content: '在吗' }],
        temperature: 0.2,
        maxAttempts: 1,
      }),
    /unexpected model/,
  );
});

// ── 结构化输出的容错解析（用户实测：一键完善约 20% 失败）──
//
// provider 只请求了通用 JSON 模式（response_format: json_object），不是严格 schema，
// 模型偶尔会在 JSON 前后带一句话或补一段说明。原实现只剥首尾围栏，这类响应被判成
// malformed；下面钉住退化路径。

test('DeepSeek accepts structured JSON wrapped in surrounding prose', async () => {
  const provider = providerWith(
    asFetch(async () =>
      Response.json({
        model: MODEL,
        choices: [{ message: { content: '好的，这是完善后的性格：{"persona":"温柔但直接"}' } }],
      }),
    ),
  );

  const result = await provider.completeStructured({
    messages: [{ role: 'user', content: 'return json' }],
    maxAttempts: 1,
    outputSchema: { name: 'persona_enhancement', schema: { type: 'object' } },
    parse: (value) => value as { persona: string },
  });

  assert.deepEqual(result.data, { persona: '温柔但直接' });
});

test('DeepSeek accepts a fenced object followed by trailing prose', async () => {
  const provider = providerWith(
    asFetch(async () =>
      Response.json({
        model: MODEL,
        choices: [{ message: { content: '```json\n{"persona":"安静而好奇"}\n```\n希望这个方向合适。' } }],
      }),
    ),
  );

  const result = await provider.completeStructured({
    messages: [{ role: 'user', content: 'return json' }],
    maxAttempts: 1,
    outputSchema: { name: 'persona_enhancement', schema: { type: 'object' } },
    parse: (value) => value as { persona: string },
  });

  assert.deepEqual(result.data, { persona: '安静而好奇' });
});

test('DeepSeek tolerates braces inside strings when extracting the object', async () => {
  const provider = providerWith(
    asFetch(async () =>
      Response.json({
        model: MODEL,
        choices: [{ message: { content: 'note: {"persona":"喜欢说 } 和 { 的人"}' } }],
      }),
    ),
  );

  const result = await provider.completeStructured({
    messages: [{ role: 'user', content: 'return json' }],
    maxAttempts: 1,
    outputSchema: { name: 'persona_enhancement', schema: { type: 'object' } },
    parse: (value) => value as { persona: string },
  });

  assert.deepEqual(result.data, { persona: '喜欢说 } 和 { 的人' });
});

// Real chat routes subtract performance.now(), which produces fractional budgets.
// Exercise the real adapter and native AbortSignal; only provider HTTP is mocked.
for (const mode of ['complete','stream'] as const) {
  test(`DeepSeek ${mode} accepts a fractional remaining generation deadline`, async () => {
    let calls=0;
    const provider=providerWith(asFetch(async (_url,init)=>{
      calls++;assert.equal(init?.signal?.aborted,false);
      return mode==='complete'
        ? Response.json({model:MODEL,choices:[{message:{content:'连接成功'},finish_reason:'stop'}]})
        : new Response('data: '+JSON.stringify({model:MODEL,choices:[{delta:{content:'连接成功'},finish_reason:'stop'}]})+'\n\n');
    }));
    const input={messages:[{role:'user' as const,content:'你好'}],timeoutMs:1000.75,maxAttempts:1};
    if(mode==='complete')assert.equal((await provider.complete(input)).content,'连接成功');
    else {let text='';for await(const chunk of provider.stream(input))text+=chunk;assert.equal(text,'连接成功');}
    assert.equal(calls,1);
  });
}
