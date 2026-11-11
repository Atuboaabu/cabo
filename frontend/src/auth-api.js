/**
 * Real registration-only API client. No login, session, JWT, or Mock coupling.
 *
 * Configure in the page before loading app.js:
 *   window.CABO_API_BASE_URL = 'http://localhost:8000';
 */
export const DEFAULT_AUTH_API_BASE_URL = 'http://localhost:8000';

export function getAuthApiBaseUrl(scope = globalThis) {
  const value = scope?.CABO_API_BASE_URL;
  if (value == null || value === '') return DEFAULT_AUTH_API_BASE_URL;
  if (typeof value !== 'string') throw new TypeError('API 地址配置无效');
  let url;
  try { url = new URL(value); } catch { throw new TypeError('API 地址配置无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new TypeError('API 地址必须是 http(s) 服务根地址，不能包含凭据、路径、查询或片段');
  }
  return url.origin;
}

export class AuthApiError extends Error {
  constructor(message, status = 0, code = 'UNKNOWN_ERROR') {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

const ERROR_MESSAGES = {
  USERNAME_TAKEN: '该昵称已被占用，请更换昵称。',
  EMAIL_ALREADY_REGISTERED: '该邮箱已注册，请直接登录或使用其他邮箱注册。',
  INVALID_USERNAME: '注册名格式不符合要求，请检查后重试。',
  INVALID_EMAIL_ADDRESS: '邮箱格式不正确，请检查后重试。',
  INVALID_VERIFICATION_CODE: '验证码错误或已过期，请检查或重新发送。',
  VERIFICATION_CODE_RATE_LIMIT: '验证码请求过于频繁，请稍后再试。',
  EMAIL_SEND_ERROR: '验证码发送失败，请稍后重试。'
};

function messageFor(status, code, operation) {
  if (Object.hasOwn(ERROR_MESSAGES, code)) return ERROR_MESSAGES[code];
  if (status === 409) return '注册信息已被使用，请更换注册名或邮箱。';
  if (status === 429) return '操作过于频繁，请稍后再试。';
  if (status === 422 || status === 400) return operation === 'register'
    ? '注册信息不符合要求，请核对注册名、邮箱、密码及验证码。'
    : '邮箱地址不符合要求，请检查后重试。';
  if (status === 503 || status >= 500) return operation === 'code'
    ? '验证码发送暂不可用，请稍后重试。'
    : '注册服务暂不可用，请稍后重试。';
  if (status === 403) return '当前请求无法完成，请稍后重试。';
  return '请求未完成，请稍后重试。';
}

function sanitizeCode(code) {
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
    ? code : 'HTTP_ERROR';
}

export function createAuthApi({ baseUrl = getAuthApiBaseUrl(), fetchImpl = globalThis.fetch } = {}) {
  // Validate explicit base URL as well, not only the global setting.
  const apiRoot = getAuthApiBaseUrl({ CABO_API_BASE_URL: baseUrl });
  if (typeof fetchImpl !== 'function') throw new TypeError('浏览器不支持网络请求');

  async function post(path, payload, expectedStatus, operation) {
    let response;
    try {
      response = await fetchImpl(apiRoot + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch {
      // Never surface fetch error objects: they may contain target or request info.
      throw new AuthApiError('连接不到注册服务，请检查网络或 API 地址。', 0, 'NETWORK_ERROR');
    }
    if (response.status !== expectedStatus) {
      let code = 'HTTP_ERROR';
      try {
        const body = await response.json();
        code = sanitizeCode(body?.code);
      } catch { /* Unsupported / malformed error body: use status code only. */ }
      throw new AuthApiError(messageFor(response.status, code, operation), response.status, code);
    }
    if (operation === 'code') return { accepted: true };
    let account;
    try { account = await response.json(); } catch {
      throw new AuthApiError('注册已返回成功状态，但账号信息无法读取，请通过登录入口确认账号状态。', expectedStatus, 'INVALID_RESPONSE');
    }
    // Account public response only. Do not store or expose request credentials.
    if (!account || typeof account.id !== 'string' || typeof account.username !== 'string' ||
        typeof account.email !== 'string' || typeof account.created_at !== 'string') {
      throw new AuthApiError('注册已返回成功状态，但账号信息不完整，请通过登录入口确认账号状态。', expectedStatus, 'INVALID_RESPONSE');
    }
    return { id: account.id, username: account.username, email: account.email, created_at: account.created_at };
  }

  return {
    requestRegistrationCode(email) {
      return post('/auth/verification-codes', {
        email_address: email, purpose: 'registration'
      }, 202, 'code');
    },
    register({ nickname, email, password, code }) {
      return post('/auth/register', {
        username: nickname, email, password, verification_code: code
      }, 201, 'register');
    }
  };
}
