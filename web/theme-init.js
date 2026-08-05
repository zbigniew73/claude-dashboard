// Ustawia motyw zanim strona sie wyrenderuje (zapobiega mrugnieciu jasnym tlem).
// Osobny plik, bo CSP zabrania skryptow inline.
(function () {
  var saved = localStorage.getItem('cx-theme') || 'system';
  document.documentElement.setAttribute('data-theme', saved);
})();
