// Native one-time head bootstrap, captured in forms-lab/users-probe/users-page.html.
if (self === top) {
  var antiCrossFraming = document.getElementById("antiCrossFraming");
  antiCrossFraming.parentNode.removeChild(antiCrossFraming);
}
else {
  top.location = self.location;
}
