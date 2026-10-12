// 구글 캘린더 양방향 동기화 (0.22.0)
// 달력 일정(events.json)만 구글 "기본(primary) 달력"과 맞춤. 메모에 붙은 날짜는 안 보냄(태훈님 결정).
//
// 규칙(태훈님 확정 2026-09-22)
//  - 충돌: 어느 쪽이든 "마지막으로 고친 값" 우선
//  - 구글에서 지운 일정 → 앱 휴지통(deletedAt). 앱에서 지운 일정 → 구글에서도 지움
//  - 시각 없는 일정(00:00) ↔ 구글 종일 일정
//  - 구글 반복 일정 → 앱에선 보기만(events.json 의 googleSeries 에 따로 보관. 수정은 구글에서)
//  - 알람은 앱에만 있음(구글 알림과 안 맞춤)
//
// 이 파일은 electron 을 모름. 네트워크(fetch)·저장(store)·시계(now)를 밖에서 받아서 씀
// → 가짜 구글 서버로 그대로 검증할 수 있게(인계서/검증_구글동기화).
//
// [주의] 파일 읽기 → 고치기 → 저장은 await 없이 한 번에 끝낼 것.
//        중간에 await 가 끼면 그 사이 사용자가 달력에서 고친 내용을 덮어씀.
//        그래서 네트워크 응답을 받을 때마다 events.json 을 "새로" 읽어서 그 결과만 반영함.

const API = 'https://www.googleapis.com/calendar/v3';
const CAL = '/calendars/primary';

class SyncError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code || 'error';
    this.status = status || 0;
  }
}

// ---------- 날짜 도우미 (로컬 시각만 씀. UTC 변환·setMonth 금지 규칙) ----------
const pad = (n) => String(n).padStart(2, '0');
function localKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseStart(start) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(start || '');
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}
function addDaysKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const x = new Date(y, m - 1, d + days);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}
// 로컬 Date → "2026-09-22T09:00:00+09:00" (구글에 보낼 모양)
function rfc3339Local(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${localKey(d)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// 구글 일정 → 앱 모양 { start, allDayDays|durationMin }. 못 알아보면 null
function fromGoogleTimes(g) {
  const s = g.start || {};
  const e = g.end || {};
  if (s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) {
    const days = e.date ? Math.max(1, daysBetween(s.date, e.date)) : 1;
    return { start: `${s.date}T00:00`, allDayDays: days, durationMin: null };
  }
  if (s.dateTime) {
    const sd = new Date(s.dateTime);
    if (isNaN(sd.getTime())) return null;
    const ed = e.dateTime ? new Date(e.dateTime) : null;
    const dur = ed && !isNaN(ed.getTime()) ? Math.max(1, Math.round((ed - sd) / 60000)) : null;
    return { start: localKey(sd), allDayDays: null, durationMin: dur };
  }
  return null;
}
// 앱 start → 구글 {start, end}. 00:00 = 종일 일정
function toGoogleTimes(start, meta, cfg, timeZone) {
  const p = parseStart(start);
  if (!p) return null;
  const dateKey = start.slice(0, 10);
  if (start.slice(11, 16) === '00:00') {
    const days = (meta && meta.allDayDays) || 1;
    return { start: { date: dateKey }, end: { date: addDaysKey(dateKey, days) } };
  }
  const sd = new Date(p.y, p.mo - 1, p.d, p.h, p.mi, 0, 0);
  const dur = (meta && meta.durationMin) || cfg.defaultDurationMin;
  const ed = new Date(sd.getTime() + dur * 60000);
  const out = { start: { dateTime: rfc3339Local(sd) }, end: { dateTime: rfc3339Local(ed) } };
  if (timeZone) { out.start.timeZone = timeZone; out.end.timeZone = timeZone; }
  return out;
}

// 구글 설명(HTML 섞일 수 있음) → 앱 "메모 한 줄"(줄바꿈 없이 500자)
function flattenNote(desc) {
  if (!desc) return '';
  return String(desc)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
function cleanTitle(t) {
  const s = String(t == null ? '' : t).replace(/\s*\r?\n\s*/g, ' ').trim().slice(0, 300);
  return s || '(제목 없음)';
}

// 동기화 대상인 구글 일정 종류(생일·근무위치·부재중 같은 특수 일정은 안 가져옴)
function isPlainEventType(g) {
  return !g.eventType || g.eventType === 'default' || g.eventType === 'fromGmail';
}

// ---------- 상태 판단 ----------
// 앱에서 고쳐서 구글에 보내야 하는 일정인지
function isDirty(ev) {
  if (!ev || ev.deletedAt) return false;
  const g = ev.google;
  if (!g || !g.id || g.remoteDeleted) return true;
  return ev.updatedAt !== g.syncedUpdatedAt;
}
// 앱에서 지워서 구글에서도 지워야 하는 일정인지
function needsRemoteDelete(ev) {
  return !!(ev && ev.deletedAt && ev.google && ev.google.id && !ev.google.remoteDeleted);
}
const ms = (iso) => { const t = new Date(iso || 0).getTime(); return isNaN(t) ? 0 : t; };

// 구글 응답 → ev.google 에 넣을 기록. base = 마지막으로 맞춘 앱 값(바뀐 칸만 보내려고)
function makeMeta(g, base, syncedUpdatedAt) {
  const t = fromGoogleTimes(g) || {};
  return {
    id: g.id,
    etag: g.etag || null,
    updated: g.updated || null,
    allDayDays: t.allDayDays || null,
    durationMin: t.durationMin || null,
    base: { title: base.title, note: base.note, start: base.start },
    syncedUpdatedAt,
    remoteDeleted: false
  };
}

// ---------- 동기화 본체 ----------
// ctx = {
//   fetch(url, {method, headers, body}) → { status, json(), text() }
//   getAccessToken(forceRefresh) → Promise<string>  (다시 로그인 필요하면 code:'reconnect' 로 throw)
//   store: { getEvents(), saveEvents(data) }
//   state: { get(), save(obj) }     // { syncToken }
//   cfg: { pastDays, futureDays, defaultDurationMin, seriesRefreshHours }
//   now() → Date, newId() → string, newAlarm() → 알람 기본값, rebaseAlarm(ev) → firedFor 다시 맞추기
//   timeZone: 'Asia/Seoul' 등
// }
function createSync(ctx) {
  const cfg = ctx.cfg;
  const nowIso = () => ctx.now().toISOString();

  async function api(method, path, { query, body, okStatuses } = {}) {
    let url = API + path;
    if (query) {
      const qs = Object.keys(query)
        .filter((k) => query[k] !== undefined && query[k] !== null)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
        .join('&');
      if (qs) url += '?' + qs;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await ctx.getAccessToken(attempt > 0);
      const headers = { Authorization: 'Bearer ' + token };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await ctx.fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      if (res.status === 401 && attempt === 0) continue; // 토큰 만료 → 새로 받아서 한 번만 다시
      if (res.status >= 200 && res.status < 300) {
        if (res.status === 204) return { status: 204, data: null };
        let data = null;
        try { data = await res.json(); } catch (e) { data = null; }
        return { status: res.status, data };
      }
      if (okStatuses && okStatuses.includes(res.status)) return { status: res.status, data: null };
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch (e) { detail = ''; }
      if (res.status === 401) throw new SyncError('구글 인증이 거절됨', 'reconnect', 401);
      throw new SyncError(`구글 응답 오류 ${res.status} ${detail}`, 'http', res.status);
    }
    throw new SyncError('구글 인증 실패', 'reconnect', 401);
  }

  // ---- 1) 가져오기(구글 → 앱) ----
  async function fetchChanges() {
    const st = ctx.state.get() || {};
    let syncToken = st.syncToken || null;
    for (let round = 0; round < 2; round++) {
      const full = !syncToken;
      const items = [];
      let pageToken = null;
      let nextSyncToken = null;
      let expired = false;
      let guard = 0;
      do {
        const query = full
          ? { timeMin: new Date(ctx.now().getTime() - cfg.pastDays * 86400000).toISOString(), singleEvents: 'false', maxResults: 250, pageToken }
          : { syncToken, maxResults: 250, pageToken };
        const r = await api('GET', CAL + '/events', { query, okStatuses: [410] });
        if (r.status === 410) { expired = true; break; }
        const d = r.data || {};
        (d.items || []).forEach((it) => items.push(it));
        pageToken = d.nextPageToken || null;
        if (!pageToken) nextSyncToken = d.nextSyncToken || null;
      } while (pageToken && ++guard < 200);
      if (expired) { syncToken = null; continue; } // 표가 만료됨 → 처음부터 다시(전체)
      return { items, nextSyncToken, full };
    }
    throw new SyncError('구글 동기화 표 재발급 실패', 'http', 410);
  }

  // 받은 목록을 events.json 에 반영(동기 — await 없음)
  function applyChanges(items, result) {
    const data = ctx.store.getEvents();
    if (!data.googleSeries || typeof data.googleSeries !== 'object') data.googleSeries = {};
    const seriesToRefresh = new Set();
    const byGid = new Map();
    const byLocalId = new Map();
    data.events.forEach((e) => {
      byLocalId.set(e.id, e);
      if (e.google && e.google.id) byGid.set(e.google.id, e);
    });
    const stamp = nowIso();
    let changed = false;

    for (const g of items) {
      if (!g || !g.id) continue;
      // 반복 일정의 한 회차만 바뀐 것 → 그 반복 일정 전체를 다시 받음
      if (g.recurringEventId) { seriesToRefresh.add(g.recurringEventId); continue; }
      // 반복 일정 본체
      if (Array.isArray(g.recurrence) && g.recurrence.length) {
        const local = byGid.get(g.id);
        if (local) {
          // 앱 일정을 구글에서 반복 일정으로 바꾼 경우 → 앱 쪽 한 개짜리는 없애고 반복 일정으로 보여줌
          data.events = data.events.filter((e) => e !== local);
          byGid.delete(g.id);
          changed = true;
        }
        if (g.status === 'cancelled') { if (data.googleSeries[g.id]) { delete data.googleSeries[g.id]; changed = true; } }
        else seriesToRefresh.add(g.id);
        continue;
      }
      // 지워진 반복 일정 본체(지운 항목은 recurrence 없이 id 만 옴)
      if (g.status === 'cancelled' && data.googleSeries[g.id]) {
        delete data.googleSeries[g.id];
        changed = true;
        continue;
      }

      const appId = g.extendedProperties && g.extendedProperties.private && g.extendedProperties.private.memoAppId;
      let local = byGid.get(g.id) || (appId ? byLocalId.get(appId) : null) || null;
      if (local && local.google && local.google.id && local.google.id !== g.id) local = null; // 다른 구글 일정과 이미 짝 → 새로

      // 구글에서 지움
      if (g.status === 'cancelled') {
        if (!local) continue;
        if (!local.google) local.google = { id: g.id };
        if (local.deletedAt) {
          if (!local.google.remoteDeleted) { local.google.remoteDeleted = true; changed = true; }
          continue;
        }
        // 앱에서 더 나중에 고쳤으면 앱 값이 이김 → 구글에 새로 만듦
        if (isDirty(local) && ms(local.updatedAt) > ms(g.updated)) {
          local.google.remoteDeleted = true;
          changed = true;
          continue;
        }
        local.deletedAt = stamp;
        local.google.remoteDeleted = true;
        result.trashed++;
        changed = true;
        continue;
      }
      if (!isPlainEventType(g)) continue;
      const t = fromGoogleTimes(g);
      if (!t) continue;
      const remote = { title: cleanTitle(g.summary), note: flattenNote(g.description), start: t.start };

      // 새 일정(폰 등에서 만든 것)
      if (!local) {
        const ev = {
          id: ctx.newId(),
          title: remote.title,
          note: remote.note,
          start: remote.start,
          alarm: ctx.newAlarm(),
          sourceMemoId: null,
          google: null,
          createdAt: stamp,
          updatedAt: stamp,
          deletedAt: null
        };
        ev.google = makeMeta(g, remote, stamp);
        data.events.push(ev);
        byGid.set(g.id, ev);
        byLocalId.set(ev.id, ev);
        result.added++;
        changed = true;
        continue;
      }

      // 이미 있는 일정
      if (local.google && local.google.id === g.id && local.google.etag && local.google.etag === g.etag) continue; // 안 바뀜(내가 보낸 것의 메아리 등)
      const localTime = local.deletedAt ? ms(local.deletedAt) : ms(local.updatedAt);
      const localPending = local.deletedAt ? needsRemoteDelete(local) || !local.google : isDirty(local);
      if (localPending && localTime >= ms(g.updated)) {
        // 앱에서 더 나중에 고침 → 앱 값 유지(아래 보내기에서 구글을 덮음). 짝 정보만 맞춤
        if (!local.google) local.google = makeMeta(g, local.google && local.google.base ? local.google.base : remote, null);
        local.google.id = g.id;
        local.google.etag = g.etag || null;
        local.google.updated = g.updated || null;
        local.google.remoteDeleted = false;
        changed = true;
        continue;
      }
      // 구글 값이 이김
      const startChanged = local.start !== remote.start;
      local.title = remote.title;
      local.note = remote.note;
      local.start = remote.start;
      if (local.deletedAt) { local.deletedAt = null; result.restored++; }
      if (startChanged && local.alarm && local.alarm.enabled) ctx.rebaseAlarm(local);
      local.updatedAt = stamp;
      local.google = makeMeta(g, remote, stamp);
      result.updated++;
      changed = true;
    }
    if (changed) ctx.store.saveEvents(data);
    return seriesToRefresh;
  }

  // ---- 2) 보내기(앱 → 구글) ----
  function bodyFor(ev, meta) {
    const times = toGoogleTimes(ev.start, meta, cfg, ctx.timeZone);
    if (!times) return null;
    return { summary: ev.title, description: ev.note || '', ...times };
  }
  // 바뀐 칸만(구글에 있는 장소·참석자·긴 설명 등을 덮지 않게)
  function patchFor(ev, meta) {
    const base = (meta && meta.base) || {};
    const body = {};
    if (ev.title !== base.title) body.summary = ev.title;
    if (ev.note !== base.note) body.description = ev.note || '';
    if (ev.start !== base.start) {
      const times = toGoogleTimes(ev.start, ev.start.slice(11, 16) === '00:00' ? meta : { durationMin: meta && meta.durationMin }, cfg, ctx.timeZone);
      if (!times) return null;
      // 종일 ↔ 시각 있는 일정으로 바뀔 때 남은 칸을 비워야 구글이 받아줌(PATCH 는 안 보낸 칸을 그대로 둠)
      if (times.start.date) {
        body.start = { date: times.start.date, dateTime: null, timeZone: null };
        body.end = { date: times.end.date, dateTime: null, timeZone: null };
      } else {
        body.start = { date: null, ...times.start };
        body.end = { date: null, ...times.end };
      }
    }
    return body;
  }
  // 응답을 받으면 파일을 새로 읽어서 그 일정의 google 기록만 고침(사이에 사용자가 고친 건 살림)
  function recordResult(localId, g, sent) {
    const data = ctx.store.getEvents();
    const ev = data.events.find((e) => e.id === localId);
    if (!ev) return;
    ev.google = makeMeta(g, sent, sent.updatedAt);
    ctx.store.saveEvents(data);
  }
  function markRemoteDeleted(localId, gid) {
    const data = ctx.store.getEvents();
    const ev = data.events.find((e) => e.id === localId);
    if (!ev || !ev.google || ev.google.id !== gid) return;
    ev.google.remoteDeleted = true;
    ctx.store.saveEvents(data);
  }

  async function insertEvent(ev, result) {
    const body = bodyFor(ev, ev.google && !ev.google.remoteDeleted ? ev.google : null);
    if (!body) return;
    body.extendedProperties = { private: { memoAppId: ev.id } };
    const r = await api('POST', CAL + '/events', { body });
    recordResult(ev.id, r.data, { title: ev.title, note: ev.note, start: ev.start, updatedAt: ev.updatedAt });
    result.pushed++;
  }

  async function pushChanges(result) {
    const snapshot = ctx.store.getEvents();
    // 앱에서 지운 일정 → 구글에서도 지움
    for (const ev of snapshot.events.filter(needsRemoteDelete)) {
      await api('DELETE', CAL + '/events/' + encodeURIComponent(ev.google.id), { okStatuses: [404, 410] });
      markRemoteDeleted(ev.id, ev.google.id);
      result.deletedRemote++;
    }
    // 휴지통에서 완전히 지운 일정 중 아직 구글에 남은 것
    const pend = Array.isArray(snapshot.pendingRemoteDeletes) ? snapshot.pendingRemoteDeletes.slice() : [];
    for (const gid of pend) {
      await api('DELETE', CAL + '/events/' + encodeURIComponent(gid), { okStatuses: [404, 410] });
      const d = ctx.store.getEvents();
      d.pendingRemoteDeletes = (d.pendingRemoteDeletes || []).filter((x) => x !== gid);
      ctx.store.saveEvents(d);
      result.deletedRemote++;
    }
    // 새로 만들었거나 고친 일정
    for (const ev of snapshot.events.filter(isDirty)) {
      if (!parseStart(ev.start)) continue;
      const g = ev.google;
      if (!g || !g.id || g.remoteDeleted) { await insertEvent(ev, result); continue; }
      const body = patchFor(ev, g);
      if (!body) continue;
      const sent = { title: ev.title, note: ev.note, start: ev.start, updatedAt: ev.updatedAt };
      if (!Object.keys(body).length) {
        // 알람만 바꾼 경우 등 — 구글에 보낼 게 없음. 맞춘 걸로 표시만
        const d = ctx.store.getEvents();
        const cur = d.events.find((e) => e.id === ev.id);
        if (cur && cur.google && cur.updatedAt === ev.updatedAt) { cur.google.syncedUpdatedAt = ev.updatedAt; ctx.store.saveEvents(d); }
        continue;
      }
      const r = await api('PATCH', CAL + '/events/' + encodeURIComponent(g.id), { body, okStatuses: [404, 410] });
      if (r.status === 404 || r.status === 410) { await insertEvent({ ...ev, google: { ...g, remoteDeleted: true } }, result); continue; }
      recordResult(ev.id, r.data, sent);
      result.pushed++;
    }
  }

  // ---- 3) 반복 일정(보기 전용) ----
  async function refreshSeries(ids, result) {
    for (const masterId of ids) {
      const now = ctx.now().getTime();
      const items = [];
      let pageToken = null;
      let gone = false;
      let guard = 0;
      do {
        const r = await api('GET', CAL + '/events/' + encodeURIComponent(masterId) + '/instances', {
          query: {
            timeMin: new Date(now - cfg.pastDays * 86400000).toISOString(),
            timeMax: new Date(now + cfg.futureDays * 86400000).toISOString(),
            maxResults: 250,
            pageToken
          },
          okStatuses: [404, 410]
        });
        if (r.status === 404 || r.status === 410) { gone = true; break; }
        const d = r.data || {};
        (d.items || []).forEach((it) => items.push(it));
        pageToken = d.nextPageToken || null;
      } while (pageToken && ++guard < 50);
      const data = ctx.store.getEvents();
      if (!data.googleSeries || typeof data.googleSeries !== 'object') data.googleSeries = {};
      if (gone) { delete data.googleSeries[masterId]; ctx.store.saveEvents(data); continue; }
      const list = [];
      items.forEach((it) => {
        if (!it || it.status === 'cancelled' || !isPlainEventType(it)) return;
        const t = fromGoogleTimes(it);
        if (!t) return;
        list.push({ id: it.id, title: cleanTitle(it.summary), note: flattenNote(it.description), start: t.start });
      });
      data.googleSeries[masterId] = { fetchedAt: ctx.now().toISOString(), items: list };
      ctx.store.saveEvents(data);
      result.series++;
    }
  }

  // 한 번 돌리기: 가져오기 → 보내기 → 반복 일정. 결과 숫자를 돌려줌
  async function runSync() {
    const result = { added: 0, updated: 0, trashed: 0, restored: 0, pushed: 0, deletedRemote: 0, series: 0, full: false };
    const { items, nextSyncToken, full } = await fetchChanges();
    result.full = full;
    const seriesIds = applyChanges(items, result);
    const st = ctx.state.get() || {};
    st.syncToken = nextSyncToken || null;
    ctx.state.save(st);

    await pushChanges(result);

    // 하루 지난 반복 일정은 다시 받음(보이는 범위가 날마다 밀려나니까)
    const data = ctx.store.getEvents();
    const series = data.googleSeries || {};
    const staleMs = cfg.seriesRefreshHours * 3600000;
    Object.keys(series).forEach((id) => {
      if (ctx.now().getTime() - ms(series[id] && series[id].fetchedAt) > staleMs) seriesIds.add(id);
    });
    await refreshSeries(seriesIds, result);
    return result;
  }

  return { runSync };
}

// 반복 일정 회차들을 달력에 그릴 목록으로 펼침(보기 전용)
function flattenSeries(googleSeries) {
  const out = [];
  if (!googleSeries || typeof googleSeries !== 'object') return out;
  Object.keys(googleSeries).forEach((masterId) => {
    const s = googleSeries[masterId];
    (s && Array.isArray(s.items) ? s.items : []).forEach((it) => {
      if (it && typeof it.start === 'string') out.push({ id: it.id, masterId, title: it.title, note: it.note || '', start: it.start });
    });
  });
  return out;
}

module.exports = {
  createSync, flattenSeries, SyncError,
  // 검증용
  _t: { fromGoogleTimes, toGoogleTimes, flattenNote, isDirty, needsRemoteDelete, rfc3339Local, addDaysKey }
};
