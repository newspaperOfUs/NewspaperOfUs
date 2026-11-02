// Sayfa çizilmeden önce çalışır: karanlık modda açılışta beyaz parlama olmasın.
(function () {
  // Başka bir sitenin içinde çerçeveyle açılırsa hiçbir şey gösterme.
  if (window.top !== window.self) document.documentElement.style.display = 'none';
  var stored = null;
  try {
    stored = localStorage.getItem('newspaper-of-us.theme');
  } catch (e) {}
  var theme = stored === 'dark' || stored === 'light' ? stored : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#14120f' : '#f5efe2');
})();
