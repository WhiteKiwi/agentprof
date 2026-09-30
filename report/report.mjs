const theme = document.querySelector('#theme');
theme.hidden = false;
document.querySelector('[for="theme"]').hidden = false;
theme.addEventListener('change', () => { document.documentElement.dataset.theme = theme.value; });
const print = document.querySelector('#print');
print.hidden = false;
print.addEventListener('click', () => window.print());
