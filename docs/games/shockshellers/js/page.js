import { mount } from './surface.js?v=muyhj86r';
// The production builder replaces this development adapter with packed markup.
const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
const markup = document.body.innerHTML;
mount(markup, css);
