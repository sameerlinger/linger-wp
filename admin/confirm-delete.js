// Replaces Decap's one-click browser confirm() on "Delete ... entry" with a
// typed confirmation: Cancel is focused by default, and Delete stays disabled
// until "delete" is typed. Decap's confirm() is synchronous, so we intercept
// the menu click, ask our own question, then re-click once with confirm()
// pre-answered. If the interception ever misses, Decap's native confirm
// still runs - this can only add a step, never remove one.
(function () {
  var allowNext = false;
  var nativeConfirm = window.confirm;
  window.confirm = function (msg) {
    if (allowNext) { allowNext = false; return true; }
    return nativeConfirm.call(window, msg);
  };

  function deleteItem(target) {
    for (var n = target; n && n !== document.body; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      var isItem = n.tagName === "LI" || n.tagName === "BUTTON" || n.getAttribute("role") === "menuitem";
      var text = (n.textContent || "").trim();
      if (isItem && /^delete\b/i.test(text) && text.length < 60) return n;
    }
    return null;
  }

  function ask(onConfirm) {
    var overlay = document.createElement("div");
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("data-confirm-delete", "");
    overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    var box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:6px;padding:24px;width:min(420px,90vw);box-shadow:0 8px 30px rgba(0,0,0,.3);color:#313d3e";
    box.innerHTML =
      '<h2 style="margin:0 0 8px;font-size:18px;color:#d1333d">Delete this page?</h2>' +
      '<p style="margin:0 0 16px">This page will be deleted and become inaccessible once you do this.</p>' +
      '<label style="display:block;margin-bottom:6px">Type <b>delete</b> to confirm:</label>' +
      '<input type="text" autocomplete="off" spellcheck="false" style="box-sizing:border-box;width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font:inherit;margin-bottom:20px">' +
      '<div style="display:flex;justify-content:flex-end;gap:8px"></div>';
    var input = box.querySelector("input");
    var row = box.querySelector("div");
    function btn(label, css) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "padding:8px 16px;border-radius:4px;border:0;font:inherit;font-weight:600;cursor:pointer;" + css;
      row.appendChild(b);
      return b;
    }
    var cancel = btn("Cancel", "background:#dfdfe3;color:#313d3e");
    var del = btn("Delete", "background:#d1333d;color:#fff");
    var armed = false;
    function sync() {
      armed = input.value.trim().toLowerCase() === "delete";
      del.disabled = !armed;
      del.style.opacity = armed ? "1" : ".4";
      del.style.cursor = armed ? "pointer" : "not-allowed";
    }
    function close() { document.removeEventListener("keydown", onKey, true); overlay.remove(); }
    function go() { if (!armed) return; close(); onConfirm(); }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "Enter" && e.target === input) { e.preventDefault(); go(); }
      else if (e.key === "Tab") { // keep focus inside the dialog
        var order = [input, cancel].concat(armed ? [del] : []);
        var i = order.indexOf(document.activeElement);
        e.preventDefault();
        order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
      }
    }
    input.addEventListener("input", sync);
    cancel.addEventListener("click", close);
    del.addEventListener("click", go);
    document.addEventListener("keydown", onKey, true);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    sync();
    cancel.focus();
  }

  document.addEventListener("click", function (e) {
    if (allowNext) return; // our own re-click
    if (e.target.closest && e.target.closest("[data-confirm-delete]")) return; // our own dialog's buttons
    var item = deleteItem(e.target);
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    ask(function () {
      allowNext = true;
      item.click();
      setTimeout(function () { allowNext = false; }, 0);
    });
  }, true);
})();
