import { handleApi, type ApiEnv } from './api';

export interface Env extends ApiEnv { ASSETS: Fetcher }

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api' || path.startsWith('/api/')) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
