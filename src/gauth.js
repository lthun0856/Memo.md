// 구글 로그인(OAuth, 데스크톱 앱 방식) (0.22.0)
// - 시스템 브라우저로 구글 로그인 → 이 PC 안의 임시 주소(127.0.0.1:임의포트)로 돌아옴 → 코드 교환
// - PKCE(S256) + state 로 가로채기 방지
// - 클라이언트 id/비밀번호는 코드에 없음. 태훈님이 설정에서 고른 JSON 파일(앱 데이터 폴더에 복사본)에서 읽음
// electron 을 모름(검증용으로 fetch·브라우저 열기를 밖에서 받음)

const http = require('http');
const crypto = require('crypto');

const DEFAULT_AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const REVOKE_URI = 'https://oauth2.googleapis.com/revoke';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'];

class AuthError extends Error {
  constructor(message, code) { super(message); this.code = code || 'error'; }
}

// 구글 콘솔에서 받은 JSON → { clientId, clientSecret, authUri, tokenUri }. 이상하면 AuthError
function parseClientJson(text) {
  let j;
  try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { throw new AuthError('JSON 파일을 읽을 수 없어요', 'badClient'); }
  const c = (j && (j.installed || j.web)) || j;
  if (!c || typeof c.client_id !== 'string' || !/\.apps\.googleusercontent\.com$/.test(c.client_id)) {
    throw new AuthError('구글 OAuth 클라이언트 파일이 아니에요(client_id 없음)', 'badClient');
  }
  return {
    clientId: c.client_id,
    clientSecret: typeof c.client_secret === 'string' ? c.client_secret : '',
    authUri: c.auth_uri || DEFAULT_AUTH_URI,
    tokenUri: c.token_uri || DEFAULT_TOKEN_URI
  };
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// id_token(JWT) 안의 이메일만 꺼냄(구글 토큰 주소에서 직접 받은 것이라 서명 검사는 생략)
function emailFromIdToken(idToken) {
  try {
    const part = String(idToken || '').split('.')[1];
    if (!part) return null;
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
    return typeof json.email === 'string' ? json.email : null;
  } catch (e) { return null; }
}

function formBody(obj) {
  return Object.keys(obj).filter((k) => obj[k] !== undefined && obj[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
}

async function postToken(fetchFn, tokenUri, params) {
  const res = await fetchFn(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(params)
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.status >= 200 && res.status < 300 && data && data.access_token) return data;
  const err = data && data.error;
  if (err === 'invalid_grant' || err === 'unauthorized_client') throw new AuthError('구글 연결이 풀렸어요. 다시 연결해 주세요', 'reconnect');
  throw new AuthError('구글 토큰 받기 실패(' + res.status + (err ? ' ' + err : '') + ')', 'network');
}

const DONE_HTML = (ok, msg) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Memo.md</title></head>
<body style="font-family:'Malgun Gothic',sans-serif;background:#f6f1e3;color:#3b362a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:40px">${ok ? '✅' : '⚠️'}</div><h2>${msg}</h2><p>이 창은 닫으셔도 돼요.</p></div></body></html>`;

// 로그인 한 번 진행. 성공하면 { accessToken, refreshToken, expiresAt, email }
// opts: { client, fetch, openExternal(url), timeoutMs, onServer(port) }
function authorize(opts) {
  const { client, openExternal } = opts;
  const fetchFn = opts.fetch;
  const timeoutMs = opts.timeoutMs || 5 * 60 * 1000;
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    let finished = false;
    let timer = null;
    const server = http.createServer();
    const finish = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { server.close(); } catch (e) { /* 이미 닫힘 */ }
      if (err) reject(err); else resolve(val);
    };
    server.on('request', (req, res) => {
      let u;
      try { u = new URL(req.url, 'http://127.0.0.1'); } catch (e) { res.writeHead(400); res.end(); return; }
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const send = (ok, msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(DONE_HTML(ok, msg)); };
      if (u.searchParams.get('state') !== state) { send(false, '잘못된 요청이에요'); return; }
      const error = u.searchParams.get('error');
      if (error) { send(false, '연결을 취소했어요'); finish(new AuthError('로그인을 취소했어요', 'cancelled')); return; }
      const code = u.searchParams.get('code');
      if (!code) { send(false, '잘못된 요청이에요'); return; }
      const port = server.address().port;
      postToken(fetchFn, client.tokenUri, {
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: `http://127.0.0.1:${port}`,
        grant_type: 'authorization_code',
        code_verifier: verifier
      }).then((tok) => {
        if (!tok.refresh_token) throw new AuthError('구글이 장기 토큰을 안 줬어요. 다시 연결해 주세요', 'network');
        send(true, '구글 캘린더 연결 완료');
        finish(null, {
          accessToken: tok.access_token,
          refreshToken: tok.refresh_token,
          expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
          email: emailFromIdToken(tok.id_token)
        });
      }).catch((err) => { send(false, '연결 실패'); finish(err); });
    });
    server.on('error', (err) => finish(new AuthError('로그인 준비 실패: ' + err.message, 'network')));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      if (opts.onServer) opts.onServer(port);
      const q = formBody({
        client_id: client.clientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent'
      });
      timer = setTimeout(() => finish(new AuthError('로그인 시간이 지났어요(5분). 다시 눌러 주세요', 'timeout')), timeoutMs);
      Promise.resolve(openExternal(client.authUri + '?' + q)).catch((e) => finish(new AuthError('브라우저를 열 수 없어요', 'network')));
    });
  });
}

// 장기 토큰으로 새 접속 토큰 받기 → { accessToken, expiresAt }
async function refreshAccessToken({ client, refreshToken, fetch: fetchFn }) {
  const tok = await postToken(fetchFn, client.tokenUri, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  return { accessToken: tok.access_token, expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000 };
}

// 연결 해제 시 구글 쪽 권한도 취소(실패해도 무시 — 로컬 토큰은 어차피 지움)
async function revokeToken({ token, fetch: fetchFn }) {
  try {
    await fetchFn(REVOKE_URI, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formBody({ token }) });
  } catch (e) { /* 무시 */ }
}

module.exports = { parseClientJson, authorize, refreshAccessToken, revokeToken, emailFromIdToken, AuthError, SCOPES };
