/*
 * core-offline.js — 让「断网后点游戏」也能进（补 EmulatorJS 的报告缓存缺口）
 *
 * 背景（vendor 行为，改不了也不该改）：
 *   每次点游戏，EmulatorJS 都会请求 cores/reports/<核心>.json?t=<时间戳>，用里面的
 *   buildStart 去比对 IndexedDB 里缓存的核心版本。断网时这个请求失败 → buildStart 被赋成
 *   100*Math.random() → 缓存永远"对不上" → 只能去下载核心 → 报「核心下载失败」。
 *
 * 本脚本只拦这一种请求：
 *   - 请求成功：把响应文本存进 localStorage（键 fcCoreReport:<文件名>），下次可用
 *   - 请求失败（断网）：用存下来的副本顶上（status 200 / readyState 4 / response=文本），
 *     EmulatorJS 拿到正确的 buildStart → 命中 IndexedDB 里的核心 → 照常进游戏
 *
 * 不修改 emulator.min.js；只作用于 cores/reports/*.json，其它请求完全不受影响。
 * 页面在断网状态下「刷新/重开」仍然打不开（那是页面本身没缓存，需要 Service Worker）。
 */
(function () {
  'use strict';

  var RE = /\/cores\/reports\/([^\/?]+\.json)(\?|$)/i;
  var PREFIX = 'fcCoreReport:';

  function nameOf(url) {
    var m = RE.exec(String(url || ''));
    return m ? m[1] : '';
  }

  function save(name, text) {
    try { localStorage.setItem(PREFIX + name, text); } catch (e) { /* 隐私模式等：忽略 */ }
  }

  function load(name) {
    try { return localStorage.getItem(PREFIX + name) || ''; } catch (e) { return ''; }
  }

  /** 用本地副本把这次请求"演"成成功响应，再交给 EmulatorJS 原来的 onload */
  function satisfy(xhr, orig, ev, text) {
    try {
      Object.defineProperty(xhr, 'response', { configurable: true, value: text });
      Object.defineProperty(xhr, 'responseText', { configurable: true, value: text });
      Object.defineProperty(xhr, 'status', { configurable: true, value: 200 });
    } catch (e) { /* ignore */ }
    if (typeof orig === 'function') {
      try { orig.call(xhr, ev); } catch (e) { /* ignore */ }
    }
  }

  function install() {
    if (typeof XMLHttpRequest === 'undefined' || !XMLHttpRequest.prototype) return;
    var proto = XMLHttpRequest.prototype;
    if (proto.__fcOfflineHooked) return;
    proto.__fcOfflineHooked = true;

    var origOpen = proto.open;
    var origSend = proto.send;

    proto.open = function (method, url) {
      try { this.__fcOffName = nameOf(url); } catch (e) { this.__fcOffName = ''; }
      return origOpen.apply(this, arguments);
    };

    proto.send = function () {
      var xhr = this;
      var name = xhr.__fcOffName;
      if (!name) return origSend.apply(this, arguments);

      var origOnload = xhr.onload;
      var origOnerror = xhr.onerror;

      xhr.onload = function (ev) {
        try {
          if ((xhr.status | 0) === 200) {
            var t = xhr.responseText;
            if (typeof t === 'string' && t) save(name, t);
          }
        } catch (e) { /* ignore */ }
        if (typeof origOnload === 'function') return origOnload.call(xhr, ev);
        return undefined;
      };

      xhr.onerror = function (ev) {
        var cached = load(name);
        if (cached) return satisfy(xhr, origOnload, ev, cached);
        if (typeof origOnerror === 'function') return origOnerror.call(xhr, ev);
        return undefined;
      };

      return origSend.apply(this, arguments);
    };
  }

  if (typeof window !== 'undefined' && typeof XMLHttpRequest !== 'undefined') install();
})();
