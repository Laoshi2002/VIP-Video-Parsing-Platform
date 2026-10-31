// Workers 入口：静态资源由 Cloudflare 自动匹配；未命中的请求（/api/*）路由到对应处理器
import { onRequestGet as searchGet } from './functions/api/search.js';
import { onRequestGet as detailGet } from './functions/api/detail.js';
import { onRequestGet as homeGet } from './functions/api/home.js';

const routes = {
  '/api/search': searchGet,
  '/api/detail': detailGet,
  '/api/home': homeGet,
};

export default {
  fetch(request, env) {
    const handler = routes[new URL(request.url).pathname];
    if (handler) return handler({ request, env });
    return env.ASSETS.fetch(request);
  },
};
