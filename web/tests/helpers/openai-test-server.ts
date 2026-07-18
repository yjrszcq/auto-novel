import { createServer, type Server } from 'node:http';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type RecordedChatRequest = {
  index: number;
  authorization: string | undefined;
  body: {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
  };
};

export type ChatResponse = {
  content: string;
  status?: number;
  errorCode?: string;
  headers?: Record<string, string>;
};

type OpenAiTestServerOptions = {
  model?: string;
  onChat?: (
    request: RecordedChatRequest,
  ) => ChatResponse | Promise<ChatResponse>;
};

const readJsonBody = async (request: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >;
};

const defaultTranslation = (request: RecordedChatRequest) => {
  const prompt = request.body.messages.at(-1)?.content ?? '';
  const numberedLines = Array.from(prompt.matchAll(/^#\d+:(.+)$/gm));
  if (numberedLines.length > 0) {
    return numberedLines
      .map((_, index) => `#${index + 1}:译文第${index + 1}行`)
      .join('\n');
  }

  const source = prompt.split('：').at(-1) ?? prompt;
  return source
    .split('\n')
    .map((_, index) => `译文第${index + 1}行`)
    .join('\n');
};

const closeServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

export const startOpenAiTestServer = async (
  options: OpenAiTestServerOptions = {},
) => {
  const requests: RecordedChatRequest[] = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;

  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'authorization, content-type',
    );
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method === 'GET' && request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: options.model ?? 'sakura-1.0.gguf',
              object: 'model',
              created: 0,
              owned_by: 'test',
              meta: {},
            },
          ],
        }),
      );
      return;
    }

    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.statusCode = 404;
      response.end();
      return;
    }

    const body = (await readJsonBody(request)) as RecordedChatRequest['body'];
    const recordedRequest: RecordedChatRequest = {
      index: requests.length,
      authorization: request.headers.authorization,
      body,
    };
    requests.push(recordedRequest);
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);

    try {
      const result = options.onChat
        ? await options.onChat(recordedRequest)
        : { content: defaultTranslation(recordedRequest) };

      if (result.status !== undefined && result.status >= 400) {
        response.statusCode = result.status;
        for (const [name, value] of Object.entries(result.headers ?? {})) {
          response.setHeader(name, value);
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            error: {
              code: result.errorCode,
              message: result.content,
            },
          }),
        );
        return;
      }

      response.setHeader('Content-Type', 'application/json');
      if (body.stream) {
        response.setHeader('Content-Type', 'text/event-stream');
        response.end(
          `data: ${JSON.stringify({
            id: `chat-${recordedRequest.index}`,
            choices: [
              {
                delta: { content: result.content },
                finish_reason: 'stop',
                index: 0,
              },
            ],
          })}\n\ndata: [DONE]\n\n`,
        );
      } else {
        response.end(
          JSON.stringify({
            id: `chat-${recordedRequest.index}`,
            model: body.model,
            choices: [
              {
                finish_reason: 'stop',
                index: 0,
                message: { content: result.content, role: 'assistant' },
              },
            ],
            usage: {
              completion_tokens: result.content.length,
              prompt_tokens: 1,
              total_tokens: result.content.length + 1,
            },
          }),
        );
      }
    } finally {
      activeRequests -= 1;
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Test server did not bind to a TCP port');
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    get activeRequests() {
      return activeRequests;
    },
    get maximumActiveRequests() {
      return maximumActiveRequests;
    },
    close: () => closeServer(server),
  };
};
