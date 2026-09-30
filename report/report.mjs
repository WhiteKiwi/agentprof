const theme = document.querySelector('#theme');
theme.hidden = false;
document.querySelector('[for="theme"]').hidden = false;
theme.addEventListener('change', () => { document.documentElement.dataset.theme = theme.value; });
const print = document.querySelector('#print');
print.hidden = false;
print.addEventListener('click', () => window.print());
for (const link of document.querySelectorAll('[data-open-span]')) link.addEventListener('click', () => {
 const target = document.getElementById(link.dataset.openSpan);
 if(target instanceof HTMLDetailsElement) { target.open = true; target.querySelector('summary').focus(); }
});
