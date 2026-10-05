import { mount } from './surface.js?v=muv84lw6';
// The production builder replaces this development adapter with packed markup.
const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
const markup = document.body.innerHTML;
mount(markup, css);
