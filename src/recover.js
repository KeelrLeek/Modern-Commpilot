(async function () {
  function go(u){ location.replace(u); }
  var LOGIN = "https://apps01.avpaas.io/commpilot/Login/";
  try {
    var d = await chrome.storage.local.get(["cpRecoverToken","cpRecoverTries","cpRecoverTs"]);
    var now = Date.now();
    var tries = (now - (d.cpRecoverTs || 0) > 15000) ? 0 : (d.cpRecoverTries || 0);
    if (tries >= 2) { await chrome.storage.local.set({ cpRecoverTries: 0 }); return go(LOGIN); }
    if (!d.cpRecoverToken) return go(LOGIN);
    await chrome.storage.local.set({ cpRecoverTries: tries + 1, cpRecoverTs: now });
    var f = document.createElement("form");
    f.method = "POST";
    f.action = "https://apps01.avpaas.io/commpilot/Common/folder_contents.jsp";
    function add(n,v){ var i=document.createElement("input"); i.type="hidden"; i.name=n; i.value=v; f.appendChild(i); }
    add("folder","R0"); add("menuId","8"); add("formtokenserial", d.cpRecoverToken);
    document.body.appendChild(f); f.submit();
  } catch (e) { go(LOGIN); }
})();
