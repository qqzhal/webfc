// ===================================================================
//  虚拟手柄补充键：「存」「读」（手机端 A/B 上方）
//
//  - EmulatorJS 的虚拟手柄是 HTML（.ejs_virtualGamepad_*），不是画布，
//    所以可以直接往 .ejs_virtualGamepad_right 里塞两个按钮，放在 A/B 上方；
//  - 「存」= QuickBar.save()，「读」= QuickBar.load()，和悬浮条、数字键 1/2 同一套槽位逻辑；
//  - 只在触屏（虚拟手柄显示）时出现，桌面端自动跟随手柄一起隐藏；
//  - 不修改 EmulatorJS 文件、不修改 quickbar.js。
//
//  移除方式：删掉 emu/index.html 里引用本文件的 <script> 即可
// ===================================================================
(function () {
  'use strict';

  var SAVE_CLS = 'ejs_extra_save';
  var LOAD_CLS = 'ejs_extra_load';

  function btnStyle(rightPx) {
    return 'position:absolute;right:' + rightPx + 'px;top:6px;' +
      'width:50px;height:50px;border:1px solid #ccc;border-radius:50%;' +
      'display:flex;align-items:center;justify-content:center;' +
      'font-size:30px;font-weight:700;color:#ddd;background:rgba(255,255,255,.06);' +
      'touch-action:manipulation;user-select:none;-webkit-user-select:none;' +
      'text-align:center;line-height:1;';
  }

  function bind(btn, fn) {
    // 触屏：pointerdown 立刻响应（比 click 快），避免和画布/手柄事件冲突
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      btn.style.background = 'rgba(255,255,255,.22)';
      setTimeout(function () { btn.style.background = 'rgba(255,255,255,.06)'; }, 140);
      try { fn(); } catch (err) { console.error(err); }
    }, { passive: false });
  }

  function makeBtn(cls, label, title, rightPx, fn) {
    var b = document.createElement('div');
    b.className = 'ejs_virtualGamepad_button cs_nes ' + cls;
    b.textContent = label;
    b.title = title;
    b.setAttribute('style', btnStyle(rightPx));
    bind(b, fn);
    return b;
  }

  function quick(action) {
    if (window.QuickBar && typeof QuickBar[action] === 'function') return QuickBar[action]();
    if (window.EJS_emulator && EJS_emulator.displayMessage) {
      EJS_emulator.displayMessage('快捷存档模块未加载');
    }
  }

  function ensure() {
    var right = document.querySelector('.ejs_virtualGamepad_right');
    if (!right) return false;
    if (right.querySelector('.' + SAVE_CLS)) return true;

    // 「存」放在 B 上方（right:75），「读」放在 A 上方（right:5），与 A/B 对齐
    // 左边 L（读档）、右边 S（存档）
    right.appendChild(makeBtn(LOAD_CLS, 'L', '读取当前槽位（同数字键 2）', 75, function () { quick('load'); }));
    right.appendChild(makeBtn(SAVE_CLS, 'S', '存档到当前槽位（同数字键 1）', 5, function () { quick('save'); }));
    return true;
  }

  function start() {
    if (ensure()) return;
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (ensure() || tries > 100) clearInterval(t);   // 最多等 10 秒（手柄是开局后才建的）
    }, 100);

    // 万一手柄 DOM 被重建（换游戏/重启核心），补回来
    try {
      var mo = new MutationObserver(function () {
        var right = document.querySelector('.ejs_virtualGamepad_right');
        if (right && !right.querySelector('.' + SAVE_CLS)) ensure();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* 老浏览器忽略 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.EJVirtualPadExtra = { ensure: ensure };
})();
