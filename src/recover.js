(async function () {
  function go(u){ location.replace(u); }
  function abs(u){ return (u && u.indexOf("http") === 0) ? u : ("https://apps01.avpaas.io" + (u || "/commpilot/Common/folder_contents.jsp")); }
  var LOGIN = "https://apps01.avpaas.io/commpilot/Login/";
  try {
    var d = await chrome.storage.local.get(["cpRecoverToken","cpRecoverNav","cpRecoverTries","cpRecoverTs"]);
    var now = Date.now();
    var tries = (now - (d.cpRecoverTs || 0) > 15000) ? 0 : (d.cpRecoverTries || 0);
    if (tries >= 2) { await chrome.storage.local.set({ cpRecoverTries: 0 }); return go(LOGIN); }
    if (!d.cpRecoverToken) return go(LOGIN);
    await chrome.storage.local.set({ cpRecoverTries: tries + 1, cpRecoverTs: now });
    var nav = (d.cpRecoverNav && d.cpRecoverNav.url) ? d.cpRecoverNav : { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
    var f = document.createElement("form");
    f.method = "POST";
    f.action = abs(nav.url);
    function add(n,v){ var i=document.createElement("input"); i.type="hidden"; i.name=n; i.value=v; f.appendChild(i); }
    var p = nav.params || {};
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) add(k, p[k]);
    add("formtokenserial", d.cpRecoverToken);
    document.body.appendChild(f); f.submit();
  } catch (e) { go(LOGIN); }
})();
